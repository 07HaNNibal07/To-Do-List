"use strict";

class DateTimePicker {
    constructor(host, prefix) {
        this.host = host;
        this.prefix = prefix;
        this.locked = false;
        host.innerHTML = `
            <input type="hidden" id="${prefix}-date">
            <input type="hidden" id="${prefix}-time">
            <p class="picker-heading">Установить дедлайн</p>
            <div class="calendar-panel">
            <div class="calendar-header">
                <span class="calendar-month" aria-live="polite"></span>
                <button type="button" class="month-previous" aria-label="Предыдущий месяц">‹</button>
                <button type="button" class="month-next" aria-label="Следующий месяц">›</button>
            </div>
            <div class="calendar-weekdays" aria-hidden="true">
                <span>Пн</span><span>Вт</span><span>Ср</span><span>Чт</span><span>Пт</span><span>Сб</span><span>Вс</span>
            </div>
            <div class="calendar-days" role="group" aria-label="Дни месяца"></div>
            </div>
            <div class="picker-time">
                <span>Время завершения</span>
                <div class="picker-clock">
                    <label>Часы<input class="picker-hours" type="number" min="0" max="23" step="1" inputmode="numeric" value="18"></label>
                    <span aria-hidden="true">:</span>
                    <label>Минуты<input class="picker-minutes" type="number" min="0" max="59" step="1" inputmode="numeric" value="00"></label>
                </div>
            </div>
            <p class="picker-preview" role="status"></p>
            <div class="picker-shortcuts">
                <button type="button" data-offset="hour">Через час</button>
                <button type="button" data-offset="tomorrow">Завтра</button>
                <button type="button" data-offset="week">Через неделю</button>
                <button type="button" class="picker-clear">Без срока</button>
            </div>
        `;
        this.dateInput = host.querySelector("#" + prefix + "-date");
        this.timeInput = host.querySelector("#" + prefix + "-time");
        this.hours = host.querySelector(".picker-hours");
        this.minutes = host.querySelector(".picker-minutes");
        this.days = host.querySelector(".calendar-days");
        host.querySelector(".month-previous").addEventListener("click", () => this.moveMonth(-1));
        host.querySelector(".month-next").addEventListener("click", () => this.moveMonth(1));
        this.days.addEventListener("click", (event) => {
            const day = event.target.closest("[data-day]");
            if (day && !day.disabled) this.selectDay(Number(day.dataset.day));
        });
        this.days.addEventListener("keydown", (event) => this.navigateDays(event));
        for (const input of [this.hours, this.minutes]) {
            input.addEventListener("input", () => {
                if (!this.dateInput.value) this.dateInput.value = DateTimePicker.dateKey(new Date());
                this.syncTime();
                this.renderDays();
            });
            input.addEventListener("change", () => {
                input.value = String(Math.max(0, Math.min(Number(input.max), Number(input.value) || 0))).padStart(2, "0");
                this.syncTime();
            });
        }
        host.querySelectorAll("[data-offset]").forEach((button) => {
            button.addEventListener("click", () => {
                const date = new Date();
                if (button.dataset.offset === "hour") date.setTime(date.getTime() + 3600000);
                else date.setDate(date.getDate() + (button.dataset.offset === "week" ? 7 : 1));
                date.setSeconds(0, 0);
                this.setValue(date.toISOString());
                this.changed();
            });
        });
        host.querySelector(".picker-clear").addEventListener("click", () => {
            this.setValue(null);
            this.changed();
        });
        this.setValue(null);
    }

    static dateKey(date) {
        const pad = (number) => String(number).padStart(2, "0");
        return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
    }

    setValue(iso) {
        const date = iso ? new Date(iso) : new Date(Date.now() + 3600000);
        this.view = new Date(date.getFullYear(), date.getMonth(), 1);
        this.dateInput.value = iso ? DateTimePicker.dateKey(date) : "";
        this.hours.value = String(date.getHours()).padStart(2, "0");
        this.minutes.value = String(date.getMinutes()).padStart(2, "0");
        this.timeInput.value = iso ? this.hours.value + ":" + this.minutes.value : "";
        this.renderDays();
        this.preview();
    }

    setDisabled(disabled) {
        this.locked = disabled;
        this.host.querySelectorAll("button, input").forEach((control) => { control.disabled = disabled; });
        this.renderDays();
    }

    moveMonth(offset) {
        this.view = new Date(this.view.getFullYear(), this.view.getMonth() + offset, 1);
        this.renderDays();
    }

    selectDay(day) {
        this.dateInput.value = DateTimePicker.dateKey(new Date(this.view.getFullYear(), this.view.getMonth(), day));
        this.syncTime();
        this.renderDays();
        this.days.querySelector('[data-day="' + day + '"]').focus();
    }

    syncTime() {
        const valid = [this.hours, this.minutes].every((input) => input.value !== "" && input.validity.valid);
        this.timeInput.value = valid ? String(Number(this.hours.value)).padStart(2, "0") + ":" + String(Number(this.minutes.value)).padStart(2, "0") : "";
        this.preview();
        this.changed();
    }

    changed() {
        document.querySelector("#" + this.prefix + "-due-error").hidden = true;
        this.host.dispatchEvent(new Event("change", { bubbles: true }));
    }

    preview() {
        let text = "Без дедлайна";
        if (this.dateInput.value && this.timeInput.value) {
            const date = new Date(this.dateInput.value + "T" + this.timeInput.value);
            const day = new Intl.DateTimeFormat("ru-RU", {
                day: "numeric", month: "long", year: "numeric",
            }).format(date).replace(" г.", "");
            text = day + ", " + this.timeInput.value;
        } else if (this.dateInput.value) {
            text = "Укажите часы от 00 до 23 и минуты от 00 до 59";
        }
        this.host.querySelector(".picker-preview").textContent = "◷ " + text;
    }

    renderDays() {
        this.host.querySelector(".calendar-month").textContent = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(this.view);
        const today = DateTimePicker.dateKey(new Date());
        const firstDay = (this.view.getDay() + 6) % 7;
        const length = new Date(this.view.getFullYear(), this.view.getMonth() + 1, 0).getDate();
        const fragment = document.createDocumentFragment();
        for (let index = 0; index < firstDay; index++) fragment.append(document.createElement("span"));
        for (let day = 1; day <= length; day++) {
            const date = new Date(this.view.getFullYear(), this.view.getMonth(), day);
            const key = DateTimePicker.dateKey(date);
            const button = document.createElement("button");
            button.type = "button";
            button.dataset.day = day;
            button.textContent = day;
            button.disabled = this.locked || key < today;
            button.setAttribute("aria-label", new Intl.DateTimeFormat("ru-RU", { dateStyle: "full" }).format(date));
            button.setAttribute("aria-pressed", String(key === this.dateInput.value));
            if (key === today) button.setAttribute("aria-current", "date");
            fragment.append(button);
        }
        this.days.replaceChildren(fragment);
    }

    navigateDays(event) {
        const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
        const button = event.target.closest("[data-day]");
        if (!button || !(event.key in offsets)) return;
        event.preventDefault();
        const target = new Date(this.view.getFullYear(), this.view.getMonth(), Number(button.dataset.day) + offsets[event.key]);
        if (DateTimePicker.dateKey(target) < DateTimePicker.dateKey(new Date())) return;
        this.view = new Date(target.getFullYear(), target.getMonth(), 1);
        this.renderDays();
        this.days.querySelector('[data-day="' + target.getDate() + '"]').focus();
    }
}
