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
    taskList.querySelectorAll("button, input").forEach((control) => {
        control.disabled = disabled;
    });
    taskList.setAttribute("aria-busy", String(writing || loadState === "loading"));
}

function showTitleError(message = "") {
    titleError.textContent = message;
    titleError.hidden = !message;
    if (message) {
        titleInput.setAttribute("aria-invalid", "true");
    } else {
        titleInput.removeAttribute("aria-invalid");
    }
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
        card.dataset.taskId = task.id;
        card.querySelector(".task-checkbox").checked = task.is_completed;
        card.querySelector(".task-name").textContent = task.title;
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

function restoreTaskFocus(taskId, controlClass) {
    if (!controlClass || document.activeElement !== document.body) {
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

async function writeTask({ url, method, body, failureMessage, applyResult }) {
    writing = true;
    actionMessage.textContent = "";
    updateControls();

    try {
        applyResult(await request(url, method, body));
        return true;
    } catch (error) {
        if (method === "POST" && error.status === 422) {
            showTitleError("Введите название от 1 до 200 символов.");
        } else if (method !== "POST" && error.status === 404) {
            await loadTasks();
            actionMessage.textContent = "Эта задача больше недоступна.";
        } else if (!error.status || error.status >= 500) {
            await loadTasks();
            actionMessage.textContent = loadState === "ready"
                ? "Подтверждение не получено. Проверьте обновлённый список перед повтором."
                : "Не удалось проверить состояние задачи. Повторите загрузку списка.";
        } else {
            actionMessage.textContent = failureMessage;
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
    const title = inputValue.trim();
    if (!title || [...title].length > 200) {
        showTitleError(title ? "Название должно содержать не более 200 символов." : "Введите название задачи.");
        titleInput.focus();
        return;
    }

    showTitleError();
    const saved = await writeTask({
        url: apiUrl,
        method: "POST",
        body: { title },
        failureMessage: "Не удалось добавить задачу.",
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

titleInput.addEventListener("input", () => showTitleError());

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
        applyResult(updated) {
            tasks = tasks.map((task) => task.id === id ? updated : task);
        },
    });
    restoreTaskFocus(id, hadFocus && "task-checkbox");
});

taskList.addEventListener("click", async (event) => {
    const button = event.target.closest(".delete-button");
    if (!button || !canWrite()) {
        return;
    }
    if (!window.confirm("Удалить эту задачу?")) {
        return;
    }
    const id = Number(button.closest(".task-card").dataset.taskId);
    const hadFocus = document.activeElement === button;

    await writeTask({
        url: apiUrl + "/" + id,
        method: "DELETE",
        failureMessage: "Не удалось удалить задачу.",
        applyResult() {
            tasks = tasks.filter((task) => task.id !== id);
        },
    });
    restoreTaskFocus(id, hadFocus && "delete-button");
});

loadTasks();
