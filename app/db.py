from pathlib import Path

from sqlalchemy import String, URL, create_engine, false
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Task(Base):
    __tablename__ = "tasks"
    __table_args__ = {"sqlite_autoincrement": True}

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(200))
    is_completed: Mapped[bool] = mapped_column(default=False, server_default=false())


def create_sqlite_engine(path: Path):
    return create_engine(URL.create("sqlite+pysqlite", database=str(path)))
