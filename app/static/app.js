"use strict";

const apiUrl = "/api/tasks";
const form = document.querySelector("#task-form");
const titleInput = document.querySelector("#task-title");
const titleError = document.querySelector("#title-error");
const addButton = form.querySelector("button");
const filterButtons = [...document.querySelectorAll("[data-filter]")];
const counters = [...document.querySelectorAll("[data-count]")];
const taskList = document.querySelector("#task-list");
const taskTemplate = document.querySelector("#task-template");
const listState = document.querySelector("#list-state");
const listMessage = document.querySelector("#list-message");
const retryButton = document.querySelector("#retry-button");
const actionMessage = document.querySelector("#action-message");
const editDialog = document.querySelector("#edit-dialog");
const editForm = document.querySelector("#edit-form");
const editTitle = document.querySelector("#edit-title");
const editError = document.querySelector("#edit-error");
const editMessage = document.querySelector("#edit-message");
const editSave = document.querySelector("#edit-save");
const editCancel = document.querySelector("#edit-cancel");
const deleteDialog = document.querySelector("#delete-dialog");
const deleteName = document.querySelector("#delete-name");
const createDialog = document.querySelector("#create-dialog");
const createForm = document.querySelector("#create-form");
const createTitle = document.querySelector("#create-title");
const createError = document.querySelector("#create-error");
const createMessage = document.querySelector("#create-message");
let createInputValue = "";
let originalDeadline = null;
let originalDeadlineFields = "";
let originalImportance = 50;
let initialImportanceSlider = "50";
const createPicker = new DateTimePicker(document.querySelector("#create-picker"), "create");
const editPicker = new DateTimePicker(document.querySelector("#edit-picker"), "edit");

function updateImportance(prefix, value) {
    const slider = document.querySelector("#" + prefix + "-importance");
    const output = document.querySelector("#" + prefix + "-importance-value");
    const current = value ?? Number(slider.value);
    const importance = TaskTiming.importance(current);
    output.textContent = current + "/100 · " + importance.label;
    output.dataset.level = importance.level;
    slider.setAttribute("aria-valuetext", output.textContent);
}

function deadlineFields(prefix) {
    return document.querySelector("#" + prefix + "-date").value + "T"
        + document.querySelector("#" + prefix + "-time").value;
}

function readDeadline(prefix) {
    const date = document.querySelector("#" + prefix + "-date");
    const time = document.querySelector("#" + prefix + "-time");
    const error = document.querySelector("#" + prefix + "-due-error");
    const value = new Date(deadlineFields(prefix));
    let message = "";
    if (date.value || time.value) {
        if (!date.value || !time.value || !Number.isFinite(value.getTime())) {
            message = "Укажите дату и время дедлайна.";
        } else if (localDateFields(value) !== deadlineFields(prefix)) {
            message = "Это местное время недоступно. Выберите другое время.";
        } else if (value.getTime() <= Date.now()) {
            message = "Дедлайн должен быть позже текущего времени.";
        }
    }
    error.textContent = message;
    error.hidden = !message;
    for (const field of [date, time]) {
        field.setAttribute("aria-describedby", error.id);
        field.setAttribute("aria-invalid", String(Boolean(message)));
    }
    if (message) {
        document.querySelector("#" + prefix + "-picker .picker-hours").focus();
        return undefined;
    }
    return date.value ? value.toISOString() : null;
}

function localDateFields(value) {
    const pad = (number) => String(number).padStart(2, "0");
    return value.getFullYear() + "-" + pad(value.getMonth() + 1) + "-" + pad(value.getDate())
        + "T" + pad(value.getHours()) + ":" + pad(value.getMinutes());
}

const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

function updateTaskTiming(card, task, now) {
    const dates = ["Создана · " + dateFormatter.format(new Date(task.created_at))];
    dates.push(task.due_at ? "Дедлайн · " + dateFormatter.format(new Date(task.due_at)) : "Без дедлайна");
    if (task.completed_at) dates.push("Завершена · " + dateFormatter.format(new Date(task.completed_at)));
    card.querySelector(".task-dates").textContent = dates.join(" · ");
    const urgency = TaskTiming.urgency(task, now);
    card.dataset.category = TaskTiming.category(task, now);
    const uncompleted = card.dataset.category === "uncompleted";
    card.querySelector(".task-checkbox").hidden = uncompleted;
    const label = card.querySelector(".urgency-label");
    label.textContent = urgency.label;
    label.dataset.state = urgency.state;
    const importance = TaskTiming.importance(task.importance);
    const importanceLabel = card.querySelector(".importance-label");
    importanceLabel.textContent = "⚑ " + task.importance + "/100 · " + importance.label;
    importanceLabel.title = "Важность задачи";
    importanceLabel.setAttribute("aria-label", "Важность · " + importanceLabel.textContent);
    importanceLabel.dataset.level = importance.level;
    card.querySelector(".time-budget").hidden = urgency.percent === null;
    if (urgency.percent !== null) {
        const percent = Math.floor(urgency.percent);
        card.querySelector(".time-caption").textContent = "Израсходовано времени · " + percent + "%";
        const progress = card.querySelector(".time-progress");
        progress.value = urgency.percent;
        progress.dataset.state = urgency.state;
    }
}

function refreshTiming() {
    const now = Date.now();
    const visibleIds = visibleTasks(now).map((task) => String(task.id));
    const cards = [...taskList.children];
    if (visibleIds.length !== cards.length || cards.some((card, index) => card.dataset.taskId !== visibleIds[index])) {
        const focused = document.activeElement;
        const card = focused.closest(".task-card");
        const controlClass = [...focused.classList].find((name) => ["task-checkbox", "edit-button", "delete-button"].includes(name));
        render(now, false);
        if (card) restoreTaskFocus(card.dataset.taskId, controlClass);
        return;
    }
    updateCounts(now);
    for (const card of taskList.children) {
        const task = tasks.find((item) => item.id === Number(card.dataset.taskId));
        if (task) updateTaskTiming(card, task, now);
    }
}

const emptyMessages = {
    all: "Задач пока нет. Добавьте первую.",
    active: "Нет активных задач.",
    completed: "Нет выполненных задач.",
    uncompleted: "Нет невыполненных задач.",
};

let tasks = [];
let selectedFilter = "all";
try {
    const savedFilter = localStorage.getItem("crimson-filter");
    if (filterButtons.some((button) => button.dataset.filter === savedFilter)) {
        selectedFilter = savedFilter;
    }
} catch {
    // Keep filters usable when browser storage is unavailable.
}
let loadState = "loading";
let hasSnapshot = false;
let writing = false;
let deadlineTimer;

function selectFilter(filter) {
    selectedFilter = filter;
    try {
        localStorage.setItem("crimson-filter", filter);
    } catch {
        // The selected filter still applies for the current page.
    }
}

class ApiError extends Error {
    constructor(status) {
        super("HTTP " + status);
        this.status = status;
    }
}

async function request(url, method = "GET", body) {
    const options = { method, cache: "no-store" };
    if (body !== undefined) {
        options.headers = { "Content-Type": "application/json" };
        options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    if (!response.ok) {
        throw new ApiError(response.status);
    }
    return response.status === 204 ? undefined : response.json();
}

function canWrite() {
    return loadState === "ready" && !writing;
}

function updateControls(updateEditors = true) {
    const disabled = !canWrite();
    addButton.disabled = disabled;
    if (updateEditors) {
        editSave.disabled = disabled;
        editCancel.disabled = writing;
        editTitle.readOnly = writing;
        createDialog.querySelectorAll("input, button").forEach((control) => {
            control.disabled = writing;
        });
        editDialog.querySelectorAll('input[type="range"]').forEach((control) => {
            control.disabled = writing;
        });
        createPicker.setDisabled(writing);
        editPicker.setDisabled(writing);
    }
    taskList.querySelectorAll("button, input").forEach((control) => {
        control.disabled = disabled;
    });
    taskList.setAttribute("aria-busy", String(writing || loadState === "loading"));
}

function showTitleError(input, feedback, message = "") {
    feedback.textContent = message;
    feedback.hidden = !message;
    if (message) {
        input.setAttribute("aria-invalid", "true");
    } else {
        input.removeAttribute("aria-invalid");
    }
}

function readTitle(input, feedback) {
    const title = input.value.trim();
    let message = "";
    if (!title) {
        message = "Введите название задачи.";
    } else if ([...title].length > 200) {
        message = "Название должно содержать не более 200 символов.";
    }
    showTitleError(input, feedback, message);
    if (message) {
        input.focus();
        return null;
    }
    return title;
}

function replaceTask(updated) {
    tasks = tasks.map((task) => task.id === updated.id ? updated : task);
}

function visibleTasks(now = Date.now()) {
    return tasks
        .filter((task) => selectedFilter === "all"
            || TaskTiming.category(task, now) === selectedFilter)
        .sort((left, right) => Number(left.is_completed) - Number(right.is_completed)
            || right.id - left.id);
}

function updateCounts(now) {
    const counts = { all: tasks.length, active: 0, completed: 0, uncompleted: 0 };
    for (const task of tasks) counts[TaskTiming.category(task, now)]++;
    for (const counter of counters) {
        counter.textContent = hasSnapshot ? counts[counter.dataset.count] : "—";
    }
    clearTimeout(deadlineTimer);
    const deadlines = tasks
        .filter((task) => task.due_at && TaskTiming.category(task, now) === "active")
        .map((task) => Date.parse(task.due_at));
    if (deadlines.length) {
        const delay = Math.max(1, Math.min(Math.min(...deadlines) - now, 2147483647));
        deadlineTimer = setTimeout(refreshTiming, delay);
    }
}

function render(now = Date.now(), updateEditors = true) {
    updateCounts(now);
    for (const button of filterButtons) {
        button.setAttribute("aria-pressed", String(button.dataset.filter === selectedFilter));
    }

    const visible = visibleTasks(now);
    const cards = document.createDocumentFragment();
    for (const task of visible) {
        const card = taskTemplate.content.firstElementChild.cloneNode(true);
        const checkbox = card.querySelector(".task-checkbox");
        const name = card.querySelector(".task-name");
        card.dataset.taskId = task.id;
        name.id = "task-name-" + task.id;
        name.textContent = task.title;
        checkbox.checked = task.is_completed;
        checkbox.setAttribute("aria-labelledby", name.id);
        card.querySelector(".edit-button").setAttribute("aria-label", "Изменить название задачи «" + task.title + "»");
        card.querySelector(".delete-button").setAttribute("aria-label", "Удалить задачу «" + task.title + "»");
        updateTaskTiming(card, task, now);
        cards.append(card);
    }
    taskList.replaceChildren(cards);

    retryButton.hidden = loadState !== "error";
    listState.hidden = loadState === "ready" && visible.length > 0;
    if (loadState === "loading") {
        listMessage.textContent = "Загружаем задачи…";
    } else if (loadState === "error") {
        listMessage.textContent = "Не удалось загрузить список задач.";
    } else {
        listMessage.textContent = emptyMessages[tasks.length === 0 ? "all" : selectedFilter];
    }
    updateControls(updateEditors);
}

async function loadTasks() {
    loadState = "loading";
    render();
    try {
        tasks = await request(apiUrl);
        hasSnapshot = true;
        loadState = "ready";
    } catch {
        loadState = "error";
    }
    render();
}

function restoreTaskFocus(taskId, controlClass, force = false) {
    if (!controlClass || (!force && document.activeElement !== document.body)) {
        return;
    }
    const control = taskList.querySelector('[data-task-id="' + taskId + '"] .' + controlClass);
    if (control && !control.disabled && !control.hidden) {
        control.focus();
    } else if (!retryButton.hidden) {
        retryButton.focus();
    } else {
        filterButtons.find((button) => button.dataset.filter === selectedFilter).focus();
    }
}

async function writeTask({ url, method, body, failureMessage, applyResult, onInvalid, feedback = actionMessage }) {
    writing = true;
    actionMessage.textContent = "";
    feedback.textContent = "";
    updateControls();

    try {
        applyResult(await request(url, method, body));
        return true;
    } catch (error) {
        if (onInvalid && error.status === 422) {
            onInvalid();
        } else if (method !== "POST" && error.status === 404) {
            await loadTasks();
            feedback.textContent = "Эта задача больше недоступна.";
        } else if (!error.status || error.status >= 500) {
            await loadTasks();
            feedback.textContent = loadState === "ready"
                ? "Подтверждение не получено. Проверьте обновлённый список перед повтором."
                : "Не удалось проверить состояние задачи. Повторите загрузку списка.";
        } else {
            feedback.textContent = failureMessage;
        }
        return false;
    } finally {
        writing = false;
        render();
    }
}

form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!canWrite()) return;
    createForm.reset();
    createPicker.setValue(null);
    createTitle.value = titleInput.value;
    createInputValue = titleInput.value;
    showTitleError(createTitle, createError);
    document.querySelector("#create-due-error").hidden = true;
    createMessage.textContent = "";
    updateImportance("create");
    createDialog.showModal();
});

titleInput.addEventListener("input", () => showTitleError(titleInput, titleError));
editTitle.addEventListener("input", () => showTitleError(editTitle, editError));

for (const button of filterButtons) {
    button.addEventListener("click", () => {
        selectFilter(button.dataset.filter);
        render();
    });
}

retryButton.addEventListener("click", async () => {
    actionMessage.textContent = "";
    await loadTasks();
    if (document.activeElement === document.body) {
        (retryButton.hidden ? titleInput : retryButton).focus();
    }
});

taskList.addEventListener("change", async (event) => {
    const checkbox = event.target.closest(".task-checkbox");
    if (!checkbox || !canWrite()) {
        return;
    }
    const id = Number(checkbox.closest(".task-card").dataset.taskId);
    const task = tasks.find((item) => item.id === id);
    if (TaskTiming.category(task) === "uncompleted") {
        checkbox.checked = task.is_completed;
        refreshTiming();
        return;
    }
    const isCompleted = checkbox.checked;
    const hadFocus = document.activeElement === checkbox;
    checkbox.checked = !isCompleted;

    await writeTask({
        url: apiUrl + "/" + id,
        method: "PATCH",
        body: { is_completed: isCompleted },
        failureMessage: "Не удалось изменить статус задачи.",
        applyResult: replaceTask,
    });
    restoreTaskFocus(id, hadFocus && "task-checkbox");
});

taskList.addEventListener("click", (event) => {
    const button = event.target.closest(".task-action");
    if (!button || !canWrite()) {
        return;
    }
    const id = Number(button.closest(".task-card").dataset.taskId);
    const task = tasks.find((item) => item.id === id);

    if (button.matches(".edit-button")) {
        editDialog.dataset.taskId = id;
        editTitle.value = task.title;
        originalDeadline = task.due_at;
        editPicker.setValue(task.due_at);
        originalDeadlineFields = deadlineFields("edit");
        document.querySelector("#edit-due-error").hidden = true;
        document.querySelector("#edit-importance").value = task.importance;
        originalImportance = task.importance;
        initialImportanceSlider = document.querySelector("#edit-importance").value;
        updateImportance("edit", task.importance);
        showTitleError(editTitle, editError);
        editMessage.textContent = "";
        editDialog.showModal();
        editTitle.select();
    } else {
        deleteDialog.dataset.taskId = id;
        deleteName.textContent = task.title;
        deleteDialog.showModal();
    }
});

editCancel.addEventListener("click", () => editDialog.close());
editDialog.addEventListener("cancel", (event) => {
    if (writing) {
        event.preventDefault();
    }
});
editDialog.addEventListener("close", () => restoreTaskFocus(editDialog.dataset.taskId, "edit-button", true));

editForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!canWrite()) {
        return;
    }
    const title = readTitle(editTitle, editError);
    if (title === null) {
        return;
    }
    const id = Number(editDialog.dataset.taskId);
    const dueAt = deadlineFields("edit") === originalDeadlineFields ? originalDeadline : readDeadline("edit");
    if (dueAt === undefined) return;
    const sliderValue = document.querySelector("#edit-importance").value;
    const changes = { title, importance: sliderValue === initialImportanceSlider ? originalImportance : Number(sliderValue) };
    if (dueAt !== originalDeadline) changes.due_at = dueAt;
    const saved = await writeTask({
        url: apiUrl + "/" + id,
        method: "PATCH",
        body: changes,
        failureMessage: "Не удалось изменить название задачи.",
        feedback: editMessage,
        onInvalid: () => { editMessage.textContent = "Проверьте название, дедлайн и важность задачи. Дедлайн должен быть в будущем."; },
        applyResult: replaceTask,
    });
    if (saved) {
        editDialog.close();
    } else if (!tasks.some((task) => task.id === id)) {
        actionMessage.textContent = editMessage.textContent;
        editDialog.close();
    } else {
        editTitle.focus();
    }
});

deleteDialog.addEventListener("submit", async (event) => {
    event.preventDefault();
    deleteDialog.close();
    if (event.submitter?.value !== "delete" || !canWrite()) {
        return;
    }
    const id = Number(deleteDialog.dataset.taskId);
    await writeTask({
        url: apiUrl + "/" + id,
        method: "DELETE",
        failureMessage: "Не удалось удалить задачу.",
        applyResult() {
            tasks = tasks.filter((task) => task.id !== id);
        },
    });
    restoreTaskFocus(id, "delete-button");
});

for (const prefix of ["create", "edit"]) {
    document.querySelector("#" + prefix + "-importance").addEventListener("input", () => updateImportance(prefix));
}
createTitle.addEventListener("input", () => showTitleError(createTitle, createError));
document.querySelector("#create-cancel").addEventListener("click", () => createDialog.close());
createDialog.addEventListener("cancel", (event) => {
    if (writing) event.preventDefault();
});
createDialog.addEventListener("close", () => titleInput.focus());
createForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!canWrite()) return;
    const title = readTitle(createTitle, createError);
    if (title === null) return;
    const dueAt = readDeadline("create");
    if (dueAt === undefined) return;
    const saved = await writeTask({
        url: apiUrl,
        method: "POST",
        body: { title, due_at: dueAt, importance: Number(document.querySelector("#create-importance").value) },
        failureMessage: "Не удалось создать задачу.",
        feedback: createMessage,
        onInvalid: () => { createMessage.textContent = "Проверьте название, дедлайн и важность задачи. Дедлайн должен быть в будущем."; },
        applyResult(task) {
            tasks.push(task);
            if (titleInput.value === createInputValue) titleInput.value = "";
            if (selectedFilter !== "all") selectFilter("active");
        },
    });
    if (saved) createDialog.close();
});

setInterval(refreshTiming, 60000);
document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshTiming();
});
loadTasks();
