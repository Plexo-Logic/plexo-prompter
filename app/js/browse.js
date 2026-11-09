/**
 * The All scripts screen: the list of scripts on the left, the selected one on the right with its
 * timings and actions. On narrow screens the list and the script take turns.
 */
(function (Plexo) {
  "use strict";

  const { $, $$, html, raw, setHtml, toast, storage, formatDuration, relativeDate, plural, pressToContinue, isNarrow } = Plexo.util;
  const { library, views } = Plexo;
  const prefs = Plexo.settings.values;

  const SELECTION_KEY = "plexo.selected";
  const ICON = (name) => raw(`<svg class="icon"><use href="#i-${name}"/></svg>`);

  let tab = "saved"; // "saved" or "folder"
  let selectedId = storage.get(SELECTION_KEY, null);
  let detailOpen = false; // narrow screens: showing the selected script instead of the list

  /* ---------- the list ---------- */

  function visibleScripts() {
    const query = $("#library-search").value.trim().toLowerCase();
    const list = tab === "folder" ? library.folder().scripts : library.all();
    if (!query) return list;
    return list.filter((s) => s.name.toLowerCase().includes(query) || s.text.toLowerCase().includes(query));
  }

  function render() {
    const folder = library.folder();
    if (tab === "folder" && !library.folderAvailable()) tab = "saved";

    $$("#library-tabs [data-tab]").forEach((button) => button.classList.toggle("on", button.dataset.tab === tab));
    $("#library-count-saved").textContent = library.count() || "";
    $("#library-tab-folder").hidden = !library.folderAvailable();
    $("#library-folder-label").textContent = folder.mode === "none" ? "Link a folder" : "Scripts folder";
    setHtml($("#library-count-folder"), folder.mode === "none" ? "" : html`${folder.scripts.length || ""}<span class="live-dot" title="Watching for new files"></span>`);

    const list = visibleScripts();
    $("#library-title").textContent = tab === "folder" ? folder.label || "Scripts folder" : "All scripts";
    $("#library-total").textContent = plural(list.length, "script", "scripts");
    if (!list.some((s) => s.id === selectedId)) selectedId = list.length ? list[0].id : null;

    const emptyMessage = $("#library-search").value
      ? "No scripts match that search."
      : tab === "folder"
        ? "This folder has no text files yet. Save a .txt file in it and it appears here within a couple of seconds."
        : "No saved scripts yet. Open a file or write a new script to get started.";

    setHtml(
      $("#library-list"),
      list.length
        ? list.map(
            (s) => html`
              <div class="list-row${s.id === selectedId ? " on" : ""}" data-id="${s.id}">
                <b>${s.name}</b>
                <span class="list-length">${formatDuration(Plexo.script.totalSeconds(s.text, prefs.wordsPerMinute))}</span>
                <span class="list-excerpt">${Plexo.script.excerpt(s.text) || "Empty script"}</span>
              </div>`
          )
        : html`<div class="list-empty">${emptyMessage}</div>`
    );

    const footer = $("#library-footer");
    if (tab !== "folder") setHtml(footer, "");
    else if (folder.mode === "launcher") setHtml(footer, html`<button class="btn sm" data-action="reveal-folder">Open the Scripts folder</button>`);
    else setHtml(footer, html`<button class="btn sm" data-action="link-folder">Choose another folder</button>`);

    renderSelected();
    $("#library").classList.toggle("show-detail", isNarrow() && detailOpen && Boolean(library.find(selectedId)));
  }

  /* ---------- the selected script ---------- */

  function renderSelected() {
    const pane = $("#library-preview");
    const script = library.find(selectedId);
    storage.set(SELECTION_KEY, selectedId);
    if (!script) {
      setHtml(pane, html`<div class="preview-empty">Select a script to see it here.</div>`);
      return;
    }

    const parsed = Plexo.script.parse(script.text);
    const timing = Plexo.script.timeline(parsed, prefs.wordsPerMinute);
    const isSaved = script.source === "saved";
    const headingCount = parsed.blocks.filter((b) => b.type === "heading").length;
    const hasHeadings = headingCount > 0;

    // With sections, times sit next to the section headings; without, next to each paragraph.
    const outline = parsed.blocks.map((block, i) => {
      const time = timing.times[i];
      if (block.type === "heading") return html`<div class="outline-time heading">${formatDuration(time || 0)}</div><div class="outline-heading">${block.text}</div>`;
      if (block.type === "pause") {
        const label = block.seconds ? `${block.seconds} second pause` : `Stops until you ${pressToContinue}`;
        return html`<div class="outline-time">${hasHeadings ? "" : formatDuration(time || 0)}</div><div class="outline-pause">${label}</div>`;
      }
      const showTime = !hasHeadings && time !== null;
      return html`<div class="outline-time">${showTime ? formatDuration(time) : ""}</div><p>${raw(block.html)}</p>`;
    });

    const menu = isSaved
      ? html`
          <button data-action="rename">Rename</button>
          <button data-action="duplicate">Duplicate</button>
          <button data-action="download">Download as text file</button>
          <button data-action="copy-timings">Copy timings</button>
          <hr />
          <button class="danger" data-action="delete">Delete</button>`
      : html`
          <button data-action="save-copy">Save a copy to my scripts</button>
          <button data-action="copy-timings">Copy timings</button>
          ${library.folder().mode === "launcher" ? html`<button data-action="reveal-folder">Open the Scripts folder</button>` : ""}`;

    setHtml(
      pane,
      html`
        <div class="preview-head">
          <button class="btn ghost sm preview-back" data-action="back-to-list">${ICON("back")}All scripts</button>
          <h1>${script.name}</h1>
          <div class="preview-meta">
            <span><b>${formatDuration(timing.total)}</b> at ${prefs.wordsPerMinute} words a minute</span>
            <span><b>${timing.words}</b> words</span>
            ${headingCount ? html`<span><b>${headingCount}</b> ${headingCount === 1 ? "section" : "sections"}</span>` : ""}
            ${timing.waits ? html`<span><b>${timing.waits}</b> ${timing.waits === 1 ? "stop that waits" : "stops that wait"} for you</span>` : ""}
            <span>${isSaved ? `Edited ${relativeDate(script.updated)}` : "In your Scripts folder"}</span>
          </div>
          <div class="preview-actions">
            <button class="btn primary" data-action="read">${ICON("play")}Start prompter</button>
            <button class="btn" data-action="edit">${isSaved ? "Edit" : "Open in editor"}</button>
            <button class="btn" data-action="more" aria-expanded="false">More</button>
            <div class="menu">${menu}</div>
          </div>
        </div>
        <div class="preview-body"><div class="outline">${outline}</div></div>`
    );
  }

  function closeMenus() {
    $$(".menu.on").forEach((menu) => menu.classList.remove("on"));
    $$('[data-action="more"]').forEach((button) => button.setAttribute("aria-expanded", "false"));
  }

  function onAction(event) {
    const button = event.target.closest("[data-action]");
    if (button?.dataset.action === "back-to-list") {
      detailOpen = false;
      return render();
    }
    const script = library.find(selectedId);
    if (!button || !script) return;
    const action = button.dataset.action;
    if (action !== "more") closeMenus();

    switch (action) {
      case "read":
        return Plexo.app.read(script);
      case "edit":
        return Plexo.editor.open(script);
      case "more": {
        const menu = $("#library-preview .menu");
        menu.style.left = `${button.offsetLeft}px`;
        button.setAttribute("aria-expanded", String(menu.classList.toggle("on")));
        event.stopPropagation();
        return;
      }
      case "rename":
        Plexo.dialog.prompt("Rename script", { value: script.name, action: "Rename" }).then((name) => {
          if (name && name.trim()) library.rename(script.id, name);
        });
        return;
      case "duplicate":
        selectedId = library.duplicate(script.id).id;
        render();
        return toast("Duplicated");
      case "download":
        return library.download(script);
      case "copy-timings":
        return Plexo.editor.copyTimings(script.name, script.text);
      case "save-copy":
        selectedId = library.add(script.name, script.text).id;
        tab = "saved";
        render();
        return toast("Saved to your scripts");
      case "reveal-folder":
        return library.revealLauncherFolder();
      case "delete":
        Plexo.dialog.confirm(`Delete “${script.name}”?`, { message: "This can’t be undone.", action: "Delete", danger: true }).then((yes) => {
          if (!yes) return;
          library.remove(script.id);
          selectedId = null;
          toast("Deleted");
        });
        return;
      default:
    }
  }

  /* ---------- opening the screen ---------- */

  /** Shows All scripts, optionally on a tab and with a script selected. */
  function show(nextTab = "saved", id) {
    tab = nextTab;
    if (id !== undefined) selectedId = id;
    detailOpen = Boolean(id);
    $("#library-search").value = "";
    if (views.current() === "library") render();
    else views.show("library");
  }

  /** Picks a folder if needed, then shows the folder tab. */
  async function useFolder() {
    const folder = library.folder();
    if (folder.mode === "none" && !(await library.reconnectFolder()) && !(await library.linkFolder())) return;
    show("folder", null);
  }

  /** Arrow keys in the list. */
  function moveSelection(step) {
    const list = visibleScripts();
    if (!list.length) return;
    const index = Math.max(0, list.findIndex((s) => s.id === selectedId));
    selectedId = list[Math.min(list.length - 1, Math.max(0, index + step))].id;
    render();
    const row = $(`.list-row[data-id="${CSS.escape(selectedId)}"]`);
    if (row) row.scrollIntoView({ block: "nearest" });
  }

  /* ---------- wiring ---------- */

  $("#library-preview").addEventListener("click", onAction);
  $("#library-search").addEventListener("input", render);
  $("#library-list").addEventListener("click", (event) => {
    const row = event.target.closest(".list-row");
    if (!row) return;
    selectedId = row.dataset.id;
    detailOpen = true;
    render();
  });
  $("#library-list").addEventListener("dblclick", (event) => {
    const row = event.target.closest(".list-row");
    const script = row && library.find(row.dataset.id);
    if (script) Plexo.app.read(script);
  });
  $("#library-footer").addEventListener("click", (event) => {
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (action === "reveal-folder") library.revealLauncherFolder();
    if (action === "link-folder") library.linkFolder();
  });
  $$("#library-tabs [data-tab]").forEach((button) =>
    button.addEventListener("click", () => (button.dataset.tab === "folder" ? useFolder() : show("saved", null)))
  );
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".preview-actions")) closeMenus();
  });

  const renderIfShown = () => views.current() === "library" && render();
  library.onChange(renderIfShown);
  Plexo.settings.onChange((keys) => keys.includes("wordsPerMinute") && renderIfShown());

  views.define("library", { enter: render, restore: () => views.show("library") });

  Plexo.browse = {
    show, useFolder, moveSelection, closeMenus,
    selected: () => library.find(selectedId),
    /** Remembers which script to select next time All scripts opens. */
    select: (id) => {
      selectedId = id;
    },
  };
})(window.Plexo);
