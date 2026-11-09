/**
 * The start screen: a greeting, quick actions, recent scripts and the tutorial.
 */
(function (Plexo) {
  "use strict";

  const { $, html, raw, setHtml, formatDuration, relativeDate, plural } = Plexo.util;
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
                <button class="btn sm recent-read" data-action="read">Read</button>
              </div>`
          )
        : html`<div class="recent-empty">Scripts you open or write will appear here, ready for next&nbsp;time.</div>`
    );
  }

  /** A recent script: Read opens it in the prompter; anywhere else on the row shows it in All scripts. */
  $("#recent-list").addEventListener("click", (event) => {
    const row = event.target.closest(".recent-row");
    const script = row && library.find(row.dataset.id);
    if (!script) return;
    if (event.target.closest("[data-action=read]")) Plexo.app.read(script);
    else Plexo.browse.show("saved", script.id);
  });

  const renderIfShown = () => views.current() === "home" && render();
  library.onChange(renderIfShown);
  Plexo.settings.onChange((keys) => keys.includes("wordsPerMinute") && renderIfShown());

  views.define("home", { enter: render });
})(window.Plexo);
