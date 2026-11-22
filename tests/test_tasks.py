from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
import sqlite3

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
    assert first["title"] == "Первая задача"
    assert first["is_completed"] is False

    second = (await client.post("/api/tasks", json={"title": "Вторая задача"})).json()
    third = (await client.post("/api/tasks", json={"title": "Третья задача"})).json()
    second = (await client.patch(f"/api/tasks/{second['id']}", json={"is_completed": True})).json()
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
        assert response.json()["is_completed"] is completed
        assert response.json()["created_at"] == task["created_at"]
        assert (await client.get("/api/tasks")).json() == [response.json()]


@pytest.mark.parametrize("value", ["true", 1, None])
async def test_rejects_non_boolean_status(client, value):
    task = (await client.post("/api/tasks", json={"title": "Проверка валидации"})).json()
    response = await client.patch(f"/api/tasks/{task['id']}", json={"is_completed": value})
    assert response.status_code == 422
    assert (await client.get("/api/tasks")).json() == [task]


async def test_renaming_preserves_completion_and_accepts_combined_patch(client):
    task = (await client.post("/api/tasks", json={"title": "Исходное название"})).json()
    path = f"/api/tasks/{task['id']}"
    response = await client.patch(path, json={"title": "Выполнить", "is_completed": True})
    assert response.status_code == 200
    task = response.json()
    assert task["title"] == "Выполнить"
    assert task["is_completed"] is True

    response = await client.patch(path, json={"title": "  Новое название  "})
    assert response.status_code == 200
    assert response.json() == {**task, "title": "Новое название", "is_completed": True}
    assert (await client.get("/api/tasks")).json() == [response.json()]


@pytest.mark.parametrize("changes", [{}, {"title": "   "}, {"title": "я" * 201}, {"title": None, "is_completed": True}])
async def test_invalid_rename_does_not_write_changes(client, changes):
    task = (await client.post("/api/tasks", json={"title": "Исходное название"})).json()
    response = await client.patch(f"/api/tasks/{task['id']}", json=changes)
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
    assert (await client.patch(path, json={"title": "Новый заголовок"})).status_code == 404


async def test_data_survives_application_restart(tmp_path):
    database = tmp_path / "nested" / "tasks.sqlite3"
    async with running_client(database) as client:
        task = (await client.post("/api/tasks", json={"title": "Сохранить"})).json()
        response = await client.patch(f"/api/tasks/{task['id']}", json={"is_completed": True})
        assert response.status_code == 200
        response = await client.patch(f"/api/tasks/{task['id']}", json={"title": "Сохранить новое название"})
        assert response.status_code == 200
        task = response.json()

    async with running_client(database) as client:
        assert (await client.get("/api/tasks")).json() == [
            {**task, "title": "Сохранить новое название", "is_completed": True},
        ]


async def test_timestamps_and_deadline_are_utc_and_completion_is_stable(client):
    before = datetime.now(timezone.utc)
    offset = timezone(timedelta(hours=14))
    deadline = (before + timedelta(days=2)).astimezone(offset)
    response = await client.post("/api/tasks", json={
        "title": "UTC", "due_at": deadline.isoformat(), "created_at": "2000-01-01T00:00:00Z",
    })
    assert response.status_code == 201
    task = response.json()
    created = datetime.fromisoformat(task["created_at"])
    assert before <= created <= datetime.now(timezone.utc)
    assert created.utcoffset() == timedelta(0)
    assert datetime.fromisoformat(task["due_at"]) == deadline
    assert task["due_at"].endswith("Z")
    assert task["completed_at"] is None

    path = f"/api/tasks/{task['id']}"
    done = (await client.patch(path, json={"is_completed": True})).json()
    assert datetime.fromisoformat(done["completed_at"]) >= created
    repeated = (await client.patch(path, json={"is_completed": True})).json()
    assert repeated == done
    renamed = (await client.patch(path, json={"title": "Updated", "importance": 100})).json()
    assert renamed["completed_at"] == done["completed_at"]
    assert renamed["created_at"] == task["created_at"]
    active = (await client.patch(path, json={"is_completed": False})).json()
    assert active["completed_at"] is None
    assert active["importance"] == 100
    assert active["created_at"] == task["created_at"]


@pytest.mark.parametrize("deadline", ["2000-01-01T00:00:00Z", "2040-01-01T12:00:00", "invalid"])
async def test_rejects_past_or_naive_deadline(client, deadline):
    response = await client.post("/api/tasks", json={"title": "Invalid", "due_at": deadline})
    assert response.status_code == 422
    task = (await client.post("/api/tasks", json={"title": "Original"})).json()
    response = await client.patch(f"/api/tasks/{task['id']}", json={"title": "Changed", "due_at": deadline})
    assert response.status_code == 422
    assert (await client.get("/api/tasks")).json() == [task]


async def test_deadline_edit_removal_and_importance_survive_restart(tmp_path):
    database = tmp_path / "tasks.sqlite3"
    async with running_client(database) as client:
        task = (await client.post("/api/tasks", json={"title": "Original"})).json()
        assert task["due_at"] is None
        assert task["importance"] == 50
        deadline = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
        response = await client.patch(f"/api/tasks/{task['id']}", json={
            "title": "Changed", "due_at": deadline, "importance": 80,
        })
        assert response.status_code == 200
        changed = response.json()
        assert changed["created_at"] == task["created_at"]
        assert changed["importance"] == 80
        assert changed["is_completed"] is False
    async with running_client(database) as client:
        assert (await client.get("/api/tasks")).json() == [changed]
        response = await client.patch(f"/api/tasks/{task['id']}", json={"due_at": None})
        assert response.status_code == 200
        assert response.json() == {**changed, "due_at": None}


@pytest.mark.parametrize("importance", [0, 50, 100])
async def test_importance_range_values(client, importance):
    task = (await client.post("/api/tasks", json={"title": "Importance", "importance": importance})).json()
    assert task["importance"] == importance
    other = 100 - importance
    response = await client.patch(f"/api/tasks/{task['id']}", json={"importance": other})
    assert response.status_code == 200
    assert response.json()["importance"] == other


@pytest.mark.parametrize("importance", [-1, 101, 50.5, True, None])
async def test_rejects_invalid_importance(client, importance):
    response = await client.post("/api/tasks", json={"title": "Invalid", "importance": importance})
    assert response.status_code == 422
    task = (await client.post("/api/tasks", json={"title": "Original"})).json()
    response = await client.patch(f"/api/tasks/{task['id']}", json={"importance": importance})
    assert response.status_code == 422
    assert (await client.get("/api/tasks")).json() == [task]


async def test_migrates_old_database_without_losing_tasks(tmp_path):
    database = tmp_path / "legacy.sqlite3"
    with sqlite3.connect(database) as connection:
        connection.execute("CREATE TABLE tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, title VARCHAR(200) NOT NULL, is_completed BOOLEAN NOT NULL)")
        connection.executemany("INSERT INTO tasks (title, is_completed) VALUES (?, ?)", [("Old active", False), ("Old done", True)])
    before = datetime.now(timezone.utc)
    async with running_client(database) as client:
        tasks = (await client.get("/api/tasks")).json()
        assert [(t["id"], t["title"], t["is_completed"]) for t in tasks] == [(1, "Old active", False), (2, "Old done", True)]
        assert tasks[0]["created_at"] == tasks[1]["created_at"]
        for task in tasks:
            assert before <= datetime.fromisoformat(task["created_at"]) <= datetime.now(timezone.utc)
            assert task["due_at"] is None
            assert task["completed_at"] is None
            assert task["importance"] == 50
    async with running_client(database) as client:
        assert (await client.get("/api/tasks")).json() == tasks
        new = await client.post("/api/tasks", json={"title": "New"})
        assert new.status_code == 201
        assert new.json()["id"] > 2
