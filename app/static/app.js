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

const emptyMessages = {
    all: "Задач пока нет. Добавьте первую.",
    active: "Нет активных задач.",
    completed: "Нет выполненных задач.",
};

let tasks = [];
let selectedFilter = "all";
let loadState = "loading";
let hasSnapshot = false;
let writing = false;

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

function updateControls() {
    const disabled = !canWrite();
    addButton.disabled = disabled;
    editSave.disabled = disabled;
    editCancel.disabled = writing;
    editTitle.readOnly = writing;
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

function visibleTasks() {
    return tasks
        .filter((task) => selectedFilter === "all"
            || task.is_completed === (selectedFilter === "completed"))
        .sort((left, right) => Number(left.is_completed) - Number(right.is_completed)
            || right.id - left.id);
}

function render() {
    const completed = tasks.filter((task) => task.is_completed).length;
    const counts = { all: tasks.length, active: tasks.length - completed, completed };

    for (const counter of counters) {
        counter.textContent = hasSnapshot ? counts[counter.dataset.count] : "—";
    }
    for (const button of filterButtons) {
        button.setAttribute("aria-pressed", String(button.dataset.filter === selectedFilter));
    }

    const visible = visibleTasks();
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
    updateControls();
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
    if (control && !control.disabled) {
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

form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!canWrite()) {
        return;
    }

    const inputValue = titleInput.value;
    const title = readTitle(titleInput, titleError);
    if (title === null) {
        return;
    }

    const saved = await writeTask({
        url: apiUrl,
        method: "POST",
        body: { title },
        failureMessage: "Не удалось добавить задачу.",
        onInvalid: () => showTitleError(titleInput, titleError, "Введите название от 1 до 200 символов."),
        applyResult(task) {
            tasks.push(task);
            if (titleInput.value === inputValue) {
                titleInput.value = "";
            }
            if (selectedFilter === "completed") {
                selectedFilter = "active";
            }
        },
    });

    if (saved || !titleError.hidden) {
        titleInput.focus();
    } else if (document.activeElement === document.body) {
        (retryButton.hidden ? titleInput : retryButton).focus();
    }
});

titleInput.addEventListener("input", () => showTitleError(titleInput, titleError));
editTitle.addEventListener("input", () => showTitleError(editTitle, editError));

for (const button of filterButtons) {
    button.addEventListener("click", () => {
        selectedFilter = button.dataset.filter;
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
    const saved = await writeTask({
        url: apiUrl + "/" + id,
        method: "PATCH",
        body: { title },
        failureMessage: "Не удалось изменить название задачи.",
        feedback: editMessage,
        onInvalid: () => showTitleError(editTitle, editError, "Введите название от 1 до 200 символов."),
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

loadTasks();
