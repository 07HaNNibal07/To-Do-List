from contextlib import asynccontextmanager

import httpx
import pytest

from app.main import create_app

pytestmark = pytest.mark.anyio


@pytest.fixture
def anyio_backend():
    return "asyncio"


@asynccontextmanager
async def running_client(database):
    app = create_app(database)
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            yield client


@pytest.fixture
async def client(tmp_path):
    async with running_client(tmp_path / "tasks.sqlite3") as http_client:
        yield http_client


async def test_home_and_empty_list(client):
    home = await client.get("/")
    assert home.status_code == 200
    assert "text/html" in home.headers["content-type"]
    assert "Crimson Tasks" in home.text

    response = await client.get("/api/tasks")
    assert response.status_code == 200
    assert response.json() == []


async def test_create_and_list_in_display_order(client):
    response = await client.post("/api/tasks", json={"title": "  Первая задача  "})
    assert response.status_code == 201
    first = response.json()
    assert first == {"id": first["id"], "title": "Первая задача", "is_completed": False}

    second = (await client.post("/api/tasks", json={"title": "Вторая задача"})).json()
    third = (await client.post("/api/tasks", json={"title": "Третья задача"})).json()
    await client.patch(f"/api/tasks/{second['id']}", json={"is_completed": True})
    tasks = (await client.get("/api/tasks")).json()
    assert tasks == [third, first, {**second, "is_completed": True}]


@pytest.mark.parametrize("title", ["", " \t\n ", "я" * 201, None, 12])
async def test_rejects_invalid_title(client, title):
    response = await client.post("/api/tasks", json={"title": title})
    assert response.status_code == 422
    assert (await client.get("/api/tasks")).json() == []


@pytest.mark.parametrize("title", ["я", "я" * 200, "🚀" * 200])
async def test_accepts_title_at_length_boundary(client, title):
    response = await client.post("/api/tasks", json={"title": f" {title} "})
    assert response.status_code == 201
    assert response.json()["title"] == title


async def test_status_changes_are_reversible_and_idempotent(client):
    task = (await client.post("/api/tasks", json={"title": "Проверка статуса"})).json()
    path = f"/api/tasks/{task['id']}"

    for completed in [True, True, False]:
        response = await client.patch(path, json={"is_completed": completed})
        assert response.status_code == 200
        assert response.json() == {**task, "is_completed": completed}
        assert (await client.get("/api/tasks")).json() == [response.json()]


@pytest.mark.parametrize("value", ["true", 1, None])
async def test_rejects_non_boolean_status(client, value):
    task = (await client.post("/api/tasks", json={"title": "Проверка валидации"})).json()
    response = await client.patch(f"/api/tasks/{task['id']}", json={"is_completed": value})
    assert response.status_code == 422
    assert (await client.get("/api/tasks")).json() == [task]


async def test_delete_and_missing_task(client):
    task = (await client.post("/api/tasks", json={"title": "Удалить"})).json()
    path = f"/api/tasks/{task['id']}"
    response = await client.delete(path)
    assert response.status_code == 204
    assert response.content == b""
    assert (await client.get("/api/tasks")).json() == []

    replacement = (await client.post("/api/tasks", json={"title": "Новая запись"})).json()
    assert replacement["id"] > task["id"]
    assert (await client.delete(path)).status_code == 404
    assert (await client.patch(path, json={"is_completed": True})).status_code == 404


async def test_data_survives_application_restart(tmp_path):
    database = tmp_path / "nested" / "tasks.sqlite3"
    async with running_client(database) as client:
        task = (await client.post("/api/tasks", json={"title": "Сохранить"})).json()
        response = await client.patch(f"/api/tasks/{task['id']}", json={"is_completed": True})
        assert response.status_code == 200

    async with running_client(database) as client:
        assert (await client.get("/api/tasks")).json() == [{**task, "is_completed": True}]
