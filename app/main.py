import os
from datetime import timezone
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Request, Response, status
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, StrictBool, StringConstraints, model_validator, field_validator
from sqlalchemy import case, delete, literal, select, update
from sqlalchemy.orm import Session, sessionmaker

from app.db import Task, UTCDateTime, create_sqlite_engine, initialize_database, utc_now

APP_DIR = Path(__file__).resolve().parent
DEFAULT_DB_PATH = APP_DIR.parent / "data" / "tasks.sqlite3"
templates = Jinja2Templates(directory=str(APP_DIR / "templates"))
TaskTitle = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Importance = Annotated[int, Field(strict=True, ge=0, le=100)]


class TaskCreate(BaseModel):
    title: TaskTitle
    due_at: AwareDatetime | None = None
    importance: Importance = 50

    @field_validator("due_at")
    @classmethod
    def require_future_deadline(cls, value):
        if value is not None and value <= utc_now():
            raise ValueError("Deadline must be in the future")
        return value.astimezone(timezone.utc) if value is not None else None


class TaskUpdate(BaseModel):
    title: TaskTitle | None = None
    is_completed: StrictBool | None = None
    due_at: AwareDatetime | None = None
    importance: Importance | None = None

    require_future_deadline = field_validator("due_at")(TaskCreate.require_future_deadline.__func__)

    @model_validator(mode="after")
    def require_changes(self):
        if not self.model_fields_set:
            raise ValueError("Provide title or is_completed")
        if any(getattr(self, field) is None for field in self.model_fields_set - {"due_at"}):
            raise ValueError("Task fields cannot be null")
        return self


class TaskRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    is_completed: bool
    created_at: AwareDatetime
    due_at: AwareDatetime | None
    completed_at: AwareDatetime | None
    importance: int


def create_app(db_path: Path | None = None) -> FastAPI:
    database = Path(db_path or os.environ.get("CRIMSON_DB_PATH") or DEFAULT_DB_PATH).resolve()
    engine = create_sqlite_engine(database)
    session_factory = sessionmaker(engine, expire_on_commit=False)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        database.parent.mkdir(parents=True, exist_ok=True)
        try:
            initialize_database(engine)
            yield
        finally:
            engine.dispose()

    application = FastAPI(title="Crimson Tasks", lifespan=lifespan)
    application.mount("/static", StaticFiles(directory=APP_DIR / "static"), name="static")

    def get_session():
        with session_factory() as session:
            yield session

    DbSession = Annotated[Session, Depends(get_session)]

    @application.get("/", response_class=HTMLResponse, include_in_schema=False)
    def home(request: Request):
        return templates.TemplateResponse(request=request, name="index.html")

    @application.get("/api/tasks", response_model=list[TaskRead])
    def list_tasks(session: DbSession):
        return session.scalars(select(Task).order_by(Task.is_completed, Task.id.desc())).all()

    @application.post("/api/tasks", response_model=TaskRead, status_code=status.HTTP_201_CREATED)
    def create_task(data: TaskCreate, session: DbSession):
        task = Task(title=data.title, due_at=data.due_at, importance=data.importance)
        session.add(task)
        session.commit()
        return task

    @application.patch("/api/tasks/{task_id}", response_model=TaskRead)
    def update_task(task_id: int, data: TaskUpdate, session: DbSession):
        changes = data.model_dump(exclude_unset=True)
        if "is_completed" in changes:
            changes["completed_at"] = (
                case((Task.is_completed.is_(False), literal(utc_now(), type_=UTCDateTime())), else_=Task.completed_at)
                if data.is_completed else None
            )
        statement = (
            update(Task)
            .where(Task.id == task_id)
            .values(**changes)
            .returning(Task)
        )
        task = session.scalars(statement).one_or_none()
        if task is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found")
        session.commit()
        return task

    @application.delete("/api/tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
    def delete_task(task_id: int, session: DbSession):
        statement = delete(Task).where(Task.id == task_id).returning(Task.id)
        if session.scalars(statement).one_or_none() is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found")
        session.commit()
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    return application


app = create_app()
