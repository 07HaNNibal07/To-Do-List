"use strict";

(() => {
    const root = document.documentElement;
    let light = false;
    try {
        light = localStorage.getItem("crimson-theme") === "light";
    } catch {
        // The switch also works when browser storage is unavailable.
    }
    root.dataset.theme = light ? "light" : "dark";

    document.addEventListener("DOMContentLoaded", () => {
        const button = document.querySelector("#theme-toggle");
        const label = document.querySelector("#theme-label");
        const symbol = button.querySelector(".theme-symbol");
        const themeColor = document.querySelector('meta[name="theme-color"]');

        function updateTheme() {
            root.dataset.theme = light ? "light" : "dark";
            button.setAttribute("aria-pressed", String(light));
            label.textContent = light ? "Тёмная тема" : "Светлая тема";
            symbol.textContent = light ? "☾" : "☀";
            themeColor.content = light ? "#f5f5f8" : "#101014";
        }

        button.addEventListener("click", () => {
            light = !light;
            updateTheme();
            try {
                localStorage.setItem("crimson-theme", light ? "light" : "dark");
            } catch {
                // Keep the current theme for this page when storage is blocked.
            }
        });
        updateTheme();
    });
})();
