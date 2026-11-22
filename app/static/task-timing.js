"use strict";

globalThis.TaskTiming = {
    category(task, now = Date.now()) {
        if (task.is_completed) return "completed";
        return now >= Date.parse(task.due_at) ? "uncompleted" : "active";
    },

    urgency(task, now = Date.now()) {
        const created = Date.parse(task.created_at);
        const due = Date.parse(task.due_at);
        const end = task.is_completed ? Date.parse(task.completed_at) : now;
        const hasDeadline = Number.isFinite(due);
        const duration = due - created;
        let percent = null;
        if (hasDeadline && Number.isFinite(end)) {
            percent = duration > 0 ? Math.max(0, Math.min(100, (end - created) / duration * 100)) : 100;
        }
        let state = "enough";
        let label = "Времени достаточно";
        const category = this.category(task, now);
        if (category === "completed") {
            state = "completed";
            label = "Выполнено";
        } else if (!hasDeadline) {
            state = "none";
            label = "Без срока";
        } else if (category === "uncompleted") {
            state = "overdue";
            const minutes = Math.floor((now - due) / 60000);
            const days = Math.floor(minutes / 1440);
            const hours = Math.floor(minutes % 1440 / 60);
            label = "Просрочено · " + (days ? days + " д " : "")
                + (hours ? hours + " ч " : "") + minutes % 60 + " мин";
        } else if (due - now <= 3 * 60 * 60 * 1000) {
            state = "urgent";
            label = "Срочно";
        } else if (percent >= 80) {
            state = "soon";
            label = "Скоро дедлайн";
        } else if (percent >= 50) {
            state = "progress";
            label = "В процессе";
        }
        return { state, label, percent };
    },

    importance(value) {
        if (value >= 80) return { label: "Критическая", level: "critical" };
        if (value > 50) return { label: "Высокая", level: "high" };
        if (value >= 25) return { label: "Средняя", level: "medium" };
        return { label: "Низкая", level: "low" };
    },
};
