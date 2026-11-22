from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import String, URL, create_engine, false
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.types import TypeDecorator, Text


def utc_now():
    return datetime.now(timezone.utc)


class UTCDateTime(TypeDecorator):
    impl = Text
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("A timezone is required")
        return value.astimezone(timezone.utc).isoformat()

    def process_result_value(self, value, dialect):
        return datetime.fromisoformat(value).astimezone(timezone.utc) if value else None


class Base(DeclarativeBase):
    pass


class Task(Base):
    __tablename__ = "tasks"
    __table_args__ = {"sqlite_autoincrement": True}

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(200))
    is_completed: Mapped[bool] = mapped_column(default=False, server_default=false())
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utc_now)
    due_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    completed_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    importance: Mapped[int] = mapped_column(default=50, server_default="50")


def initialize_database(engine):
    # SQLite serializes schema upgrades across application instances.
    with engine.connect() as connection:
        connection.exec_driver_sql("BEGIN IMMEDIATE")
        try:
            columns = {row[1] for row in connection.exec_driver_sql("PRAGMA table_info(tasks)")}
            if columns:
                if "importance" not in columns:
                    connection.exec_driver_sql("ALTER TABLE tasks ADD COLUMN importance INTEGER NOT NULL DEFAULT 50")
                for name in ("created_at", "due_at", "completed_at"):
                    if name not in columns:
                        connection.exec_driver_sql(f"ALTER TABLE tasks ADD COLUMN {name} TEXT")
                connection.exec_driver_sql(
                    "UPDATE tasks SET created_at = ? WHERE created_at IS NULL",
                    (utc_now().isoformat(),),
                )
            Base.metadata.create_all(connection)
            connection.commit()
        except BaseException:
            connection.rollback()
            raise


def create_sqlite_engine(path: Path):
    return create_engine(URL.create("sqlite+pysqlite", database=str(path)))
