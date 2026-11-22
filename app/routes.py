from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy import case, delete, literal, select, update
from sqlalchemy.orm import Session

from app.db import Task, UTCDateTime, utc_now
from app.schemas import TaskCreate, TaskRead, TaskUpdate

router = APIRouter()
templates = Jinja2Templates(directory=str(Path(__file__).resolve().parent / "templates"))


def get_session(request: Request):
    with request.app.state.session_factory() as session:
        yield session


DbSession = Annotated[Session, Depends(get_session)]



@router.get("/", response_class=HTMLResponse, include_in_schema=False)
def home(request: Request):
    return templates.TemplateResponse(request=request, name="index.html")


@router.get("/api/tasks", response_model=list[TaskRead])
def list_tasks(session: DbSession):
    return session.scalars(select(Task).order_by(Task.is_completed, Task.id.desc())).all()


@router.post("/api/tasks", response_model=TaskRead, status_code=status.HTTP_201_CREATED)
def create_task(data: TaskCreate, session: DbSession):
    task = Task(title=data.title, due_at=data.due_at, importance=data.importance)
    session.add(task)
    session.commit()
    return task


@router.patch("/api/tasks/{task_id}", response_model=TaskRead)
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


@router.delete("/api/tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(task_id: int, session: DbSession):
    statement = delete(Task).where(Task.id == task_id).returning(Task.id)
    if session.scalars(statement).one_or_none() is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found")
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
