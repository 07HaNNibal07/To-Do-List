const assert = require("node:assert/strict");
const { test } = require("node:test");
require("../app/static/task-timing.js");

const start = Date.parse("2026-12-31T22:00:00Z");
const duration = 1000 * 60 * 60 * 1000;
const task = {
    created_at: new Date(start).toISOString(),
    due_at: new Date(start + duration).toISOString(),
    completed_at: null,
    is_completed: false,
    importance: 75,
};

for (const [percent, state] of [[25, "enough"], [50, "progress"], [80, "soon"], [99, "soon"], [100, "overdue"]]) {
    test(`Elapsed ${percent}% gives ${state}`, () => {
        const result = TaskTiming.urgency(task, start + duration * percent / 100);
        assert.equal(result.percent, percent);
        assert.equal(result.state, state);
        assert.equal(task.importance, 75);
    });
}

test("Three-hour threshold overrides percentage, including a two-hour task", () => {
    const short = { ...task, due_at: new Date(start + 2 * 60 * 60 * 1000).toISOString() };
    assert.equal(TaskTiming.urgency(short, start).state, "urgent");
    assert.equal(TaskTiming.urgency(task, start + duration - 3 * 60 * 60 * 1000).state, "urgent");
    assert.equal(TaskTiming.urgency(task, start + duration - 3 * 60 * 60 * 1000 - 1).state, "soon");
    assert.equal(TaskTiming.urgency(task, start + duration + 60000).percent, 100);
});

test("Completion overrides overdue and freezes elapsed time", () => {
    const completed = { ...task, is_completed: true, completed_at: new Date(start + duration / 2).toISOString() };
    const result = TaskTiming.urgency(completed, start + duration * 2);
    assert.equal(result.state, "completed");
    assert.equal(result.percent, 50);
});

test("No deadline, unknown legacy completion, and invalid duration", () => {
    assert.deepEqual(TaskTiming.urgency({ ...task, due_at: null }, start), { state: "none", label: "Без срока", percent: null });
    assert.equal(TaskTiming.urgency({ ...task, is_completed: true }, start).percent, null);
    assert.equal(TaskTiming.urgency({ ...task, due_at: task.created_at }, start).state, "overdue");
    assert.equal(TaskTiming.urgency(task, start - 1000).percent, 0);
});

test("Timezone offsets and year boundary identify the same instant", () => {
    const shifted = { ...task, created_at: "2027-01-01T01:00:00+03:00" };
    assert.deepEqual(TaskTiming.urgency(shifted, start + duration / 2), TaskTiming.urgency(task, start + duration / 2));
});

test("Importance boundaries", () => {
    for (const [value, level] of [[0,"low"], [24,"low"], [25,"medium"], [49,"medium"], [50,"medium"], [51,"high"], [55,"high"], [79,"high"], [80,"critical"], [100,"critical"]]) {
        assert.equal(TaskTiming.importance(value).level, level);
    }
});

test("Categories are mutually exclusive and include the deadline boundary", () => {
    assert.equal(TaskTiming.category(task, start), "active");
    assert.equal(TaskTiming.category({ ...task, due_at: null }, start + duration * 2), "active");
    assert.equal(TaskTiming.category(task, start + duration - 1), "active");
    assert.equal(TaskTiming.category(task, start + duration), "uncompleted");
    assert.equal(TaskTiming.category(task, start + duration + 1), "uncompleted");
    assert.equal(TaskTiming.category({ ...task, is_completed: true }, start + duration * 2), "completed");
});

test("Completion, reopening and extending a deadline recompute the category", () => {
    const now = start + duration * 2;
    const overdue = { ...task };
    assert.equal(TaskTiming.category(overdue, now), "uncompleted");
    overdue.is_completed = true;
    overdue.completed_at = new Date(now).toISOString();
    assert.equal(TaskTiming.category(overdue, now), "completed");
    overdue.is_completed = false;
    overdue.completed_at = null;
    assert.equal(TaskTiming.category(overdue, now), "uncompleted");
    overdue.due_at = new Date(now + 3600000).toISOString();
    assert.equal(TaskTiming.category(overdue, now), "active");
});
