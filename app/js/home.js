/**
 * The start screen: a greeting, quick actions, recent scripts and the tutorial.
 */
(function (Plexo) {
  "use strict";

  const { $, html, raw, setHtml, formatDuration, relativeDate, plural, toast } = Plexo.util;
  const { library, views } = Plexo;
  const prefs = Plexo.settings.values;

  const RECENT_COUNT = 6;

  function greeting() {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    return hour < 18 ? "Good afternoon" : "Good evening";
  }

  function render() {
    const folder = library.folder();
    $("#greeting").textContent = greeting();

    $("#start-folder").hidden = !library.folderAvailable();
    $("#start-folder-title").textContent = folder.mode === "none" ? "Link a scripts folder" : "Scripts folder";
    $("#start-folder-detail").textContent =
      folder.mode === "none" ? "Files saved in it appear here automatically" : `${plural(folder.scripts.length, "script", "scripts")}, watching for new files`;

    const count = library.count();
    $("#start-all").hidden = !count;
    $("#start-all").textContent = `All scripts (${count})`;

    const recent = library.recent(RECENT_COUNT);
    $("#recent-clear").hidden = !recent.length;
    setHtml(
      $("#recent-list"),
      recent.length
        ? recent.map(
            (s) => html`
              <div class="recent-row" data-id="${s.id}">
                <span class="recent-icon">${raw('<svg class="icon"><use href="#i-doc"/></svg>')}</span>
                <span class="recent-name"><b>${s.name}</b><span>${Plexo.script.excerpt(s.text) || "Empty script"}</span></span>
                <span class="recent-length">${formatDuration(Plexo.script.totalSeconds(s.text, prefs.wordsPerMinute))}</span>
                <span class="recent-when">${relativeDate(s.opened || s.updated)}</span>
                <span class="recent-actions">
                  <button class="btn sm recent-read" data-action="read">Read</button>
                  <button class="recent-remove" data-action="remove" title="Remove from Recent" aria-label="Remove ${s.name} from Recent">${raw('<svg class="icon"><use href="#i-close"/></svg>')}</button>
                </span>
              </div>`
          )
        : html`<div class="recent-empty">Scripts you open or write will appear here, ready for next&nbsp;time.</div>`
    );
  }

  /** Remove buttons on the list, in order. */
  const removeButtons = () => [...document.querySelectorAll("#recent-list [data-action=remove]")];

  /** A recent script: Read opens it in the prompter, × takes it off the list, and anywhere else on the row shows it in All scripts. */
  $("#recent-list").addEventListener("click", (event) => {
    const row = event.target.closest(".recent-row");
    const script = row && library.find(row.dataset.id);
    if (!script) return;
    if (event.target.closest("[data-action=read]")) return Plexo.app.read(script);
    if (!event.target.closest("[data-action=remove]")) return Plexo.browse.show("saved", script.id);

    const index = removeButtons().indexOf(event.target.closest("button"));
    library.removeFromRecent(script.id); // the list redraws straight away
    toast("Removed from Recent. It’s still in All scripts.");
    // From the keyboard, carry on from the same place in the list.
    if (event.detail === 0) {
      const left = removeButtons();
      (left[index] || left[index - 1] || $("#start-all")).focus();
    }
  });

  $("#recent-clear").addEventListener("click", (event) => {
    library.removeFromRecent();
    toast("Recent cleared. Your scripts are still in All scripts.");
    if (event.detail === 0) $("#start-all").focus();
  });

  const renderIfShown = () => views.current() === "home" && render();
  library.onChange(renderIfShown);
  Plexo.settings.onChange((keys) => keys.includes("wordsPerMinute") && renderIfShown());

  views.define("home", { enter: render });
})(window.Plexo);
