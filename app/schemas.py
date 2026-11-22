from datetime import timezone
from typing import Annotated

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    StrictBool,
    StringConstraints,
    field_validator,
    model_validator,
)

from app.db import utc_now

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
