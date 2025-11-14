const FONT_STORAGE_KEY = "thensa-font-mode";
const FONT_MODES = {
  default: "default",
  minecraft: "minecraft",
};
const FONT_CLASS = "font-mode-mc";

const getStoredFont = () => {
  try {
    return localStorage.getItem(FONT_STORAGE_KEY);
  } catch (error) {
    return null;
  }
};

const persistFont = (value) => {
  try {
    localStorage.setItem(FONT_STORAGE_KEY, value);
  } catch (error) {
    /* ignore */
  }
};

const applyFontMode = (mode, buttons, shouldPersist) => {
  const activeMode = mode === FONT_MODES.minecraft ? FONT_MODES.minecraft : FONT_MODES.default;
  document.body.classList.toggle(FONT_CLASS, activeMode === FONT_MODES.minecraft);

  buttons.forEach((button) => {
    const isActive = button.dataset.fontOption === activeMode;
    button.setAttribute("aria-pressed", String(isActive));
  });

  if (shouldPersist) {
    persistFont(activeMode);
  }
};

const initFontPicker = () => {
  const picker = document.querySelector("[data-font-picker]");
  if (!picker) {
    return;
  }

  const buttons = Array.from(picker.querySelectorAll("[data-font-option]"));
  if (!buttons.length) {
    return;
  }

  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      const option = button.dataset.fontOption;
      if (!option || button.getAttribute("aria-pressed") === "true") {
        return;
      }

      applyFontMode(option, buttons, true);
    });
  });

  const stored = getStoredFont();
  applyFontMode(stored, buttons, false);
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initFontPicker, { once: true });
} else {
  initFontPicker();
}
