/**
 * The app's own confirm and prompt dialogs, used instead of the browser's so they match the rest of
 * the app on every device. Both return promises:
 *
 *   if (await Plexo.dialog.confirm("Delete “Intro”?", { action: "Delete", danger: true })) ...
 *   const name = await Plexo.dialog.prompt("Rename script", { value: "Intro", action: "Rename" });
 *
 * Built on <dialog>, so focus stays inside while it is open and Esc cancels.
 */
(function (Plexo) {
  "use strict";

  const { $, html, setHtml } = Plexo.util;
  const dialog = $("#dialog");
  let settle = null; // answers the dialog that is open, if any

  function ask({ title, message = "", value = null, action = "OK", danger = false }) {
    if (settle) settle(false); // one dialog at a time
    setHtml(
      dialog,
      html`
        <h2 id="dialog-title">${title}</h2>
        ${message ? html`<p>${message}</p>` : ""}
        ${value !== null ? html`<input class="field" id="dialog-input" maxlength="200" spellcheck="false" aria-labelledby="dialog-title">` : ""}
        <div class="dialog-actions">
          <button class="btn" data-answer="cancel">Cancel</button>
          <button class="btn ${danger ? "danger" : "primary"}" data-answer="ok">${action}</button>
        </div>`
    );
    const input = $("#dialog-input");
    if (input) input.value = value;

    return new Promise((resolve) => {
      settle = (ok) => {
        settle = null;
        const answer = input ? (ok ? input.value : null) : ok;
        if (dialog.open) dialog.close();
        resolve(answer);
      };
      dialog.showModal();
      if (input) {
        input.focus();
        input.select();
      } else {
        // A risky action starts on Cancel, so a stray Enter can't delete anything.
        $(`#dialog [data-answer="${danger ? "cancel" : "ok"}"]`).focus();
      }
    });
  }

  dialog.addEventListener("click", (event) => {
    const answer = event.target.closest("[data-answer]")?.dataset.answer;
    if (answer) settle?.(answer === "ok");
    else if (event.target === dialog) settle?.(false); // a click on the dimmed backdrop
  });
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.target.id === "dialog-input") {
      event.preventDefault();
      settle?.(true);
    }
  });
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault(); // Esc: answer "no" ourselves, so the promise always settles
    settle?.(false);
  });

  Plexo.dialog = {
    /** Resolves true or false. */
    confirm: (title, options = {}) => ask({ ...options, title }),
    /** Resolves the text typed, or null if cancelled. */
    prompt: (title, options = {}) => ask({ value: "", ...options, title }),
    isOpen: () => dialog.open,
  };
})(window.Plexo);
