/**
 * Where scripts come from:
 *   saved    scripts the user opened, pasted or wrote, kept in this browser's localStorage
 *   folder   text files in a folder, either the launcher's Scripts folder or one the user linked
 *   sample   the built-in tutorial and guide (js/samples.js)
 *
 * A script is { id, name, text, source, updated?, opened?, dismissed?, mtime? }. Ids are prefixed
 * with their source ("saved:", "folder:", "sample:") so they never clash. `dismissed` is when a saved
 * script was taken off the start screen's Recent list; using it again later brings it back.
 */
(function (Plexo) {
  "use strict";

  const { storage, createEmitter, uid, toast, stripExtension, TEXT_FILE, MAX_SCRIPT_BYTES, device } = Plexo.util;
  const SAVED_KEY = "plexo.library";
  const MAX_NAME_LENGTH = 200;
  const MAX_FOLDER_FILES = 200; // the same limit as the launcher
  const changes = createEmitter();

  /* ---------- saved scripts ---------- */

  /** Keeps only well-formed entries from storage. */
  function loadSaved() {
    const stored = storage.get(SAVED_KEY, []);
    if (!Array.isArray(stored)) return [];
    return stored
      .filter((s) => s && typeof s.id === "string" && typeof s.name === "string" && typeof s.text === "string")
      .map((s) => ({
        id: s.id.startsWith("saved:") ? s.id : `saved:${s.id}`,
        name: s.name.slice(0, MAX_NAME_LENGTH),
        text: s.text,
        source: "saved",
        updated: Number(s.updated) || 0,
        opened: Number(s.opened) || 0,
        dismissed: Number(s.dismissed) || 0,
      }));
  }

  let saved = loadSaved();

  function persist() {
    const plain = saved.map(({ id, name, text, updated, opened, dismissed }) => ({ id, name, text, updated, opened, dismissed }));
    if (!storage.set(SAVED_KEY, plain)) toast("Couldn’t save: this browser’s storage is full.", 5000);
    changes.emit({ kind: "saved" });
  }

  const lastUsed = (s) => Math.max(s.opened || 0, s.updated || 0);
  const byRecent = (a, b) => lastUsed(b) - lastUsed(a);
  const inRecent = (s) => lastUsed(s) > (s.dismissed || 0);

  /** A script name as stored: trimmed, never empty, and not too long. */
  const cleanName = (name) => (String(name).trim() || "Untitled script").slice(0, MAX_NAME_LENGTH);

  /** A name not already used by another saved script ("Intro", "Intro (2)", ...). */
  function uniqueName(name, exceptId = null) {
    const base = cleanName(name);
    const taken = (candidate) => saved.some((s) => s.id !== exceptId && s.name.toLowerCase() === candidate.toLowerCase());
    let candidate = base;
    for (let n = 2; taken(candidate); n++) candidate = `${base} (${n})`;
    return candidate;
  }

  /** Adds a script, or returns the existing one if an identical script is already saved. */
  function add(name, text) {
    const wanted = cleanName(name);
    const existing = saved.find((s) => s.name === wanted && s.text === text);
    if (existing) return existing;
    const script = { id: uid("saved"), name: uniqueName(wanted), text, source: "saved", updated: Date.now(), opened: 0 };
    saved.unshift(script);
    persist();
    return script;
  }

  /** Saves edits to an existing script, or creates it if `id` is not a saved script. */
  function save(id, name, text) {
    const script = saved.find((s) => s.id === id);
    if (!script) return add(name, text);
    Object.assign(script, { name: uniqueName(name, id), text, updated: Date.now() });
    persist();
    return script;
  }

  function rename(id, name) {
    const script = saved.find((s) => s.id === id);
    if (!script) return;
    script.name = uniqueName(name, id);
    script.updated = Date.now();
    persist();
  }

  function duplicate(id) {
    const script = saved.find((s) => s.id === id);
    return script ? add(`${script.name} copy`, script.text) : null;
  }

  function remove(id) {
    saved = saved.filter((s) => s.id !== id);
    persist();
  }

  /** Records that a saved script was just opened, so it rises to the top of Recent. */
  function markOpened(id) {
    const script = saved.find((s) => s.id === id);
    if (!script) return;
    script.opened = Date.now();
    persist();
  }

  /** Takes saved scripts off the Recent list (all of them when no id is given). They stay saved. */
  function removeFromRecent(id = null) {
    const now = Date.now();
    for (const script of saved) if (!id || script.id === id) script.dismissed = now;
    persist();
  }

  /* ---------- samples ---------- */

  const samples = (Plexo.samples || []).map((s) => ({ id: `sample:${s.name}`, name: s.name, text: s.text, source: "sample" }));
  /** The tutorial for this device: the phone one says "tap" where the other says which key to press. */
  const tutorial = () => {
    const tours = samples.filter((s) => /tutorial/i.test(s.name));
    return tours.find((s) => /phone/i.test(s.name) === device.touch) || tours[0] || samples[0] || null;
  };

  /* ---------- scripts folder ---------- */

  // movedFrom: the launcher's usual port, when it was busy and the app opened on another one.
  const folder = { mode: "none", label: "", scripts: [], handle: null, signature: "", movedFrom: 0 };
  const canLinkFolder = () => typeof window.showDirectoryPicker === "function";

  /** Replaces the folder's scripts, reporting new and updated files to subscribers. */
  function setFolderScripts(list, { quiet = false } = {}) {
    const signature = JSON.stringify(list.map((s) => [s.name, s.mtime]));
    if (signature === folder.signature) return;
    const before = new Map(folder.scripts.map((s) => [s.name, s.text]));
    folder.scripts = list.slice(0, MAX_FOLDER_FILES).map((s) => ({ id: `folder:${s.name}`, name: s.name, text: s.text, mtime: s.mtime, source: "folder" }));
    const added = folder.scripts.filter((s) => !before.has(s.name));
    const updated = folder.scripts.filter((s) => before.has(s.name) && before.get(s.name) !== s.text);
    const first = !folder.signature;
    folder.signature = signature;
    changes.emit({ kind: "folder", added: quiet || first ? [] : added, updated });
  }

  /** Asks the launcher for the Scripts folder. Resolves false when there is no launcher. */
  let launcherTag = "";

  async function pollLauncher() {
    try {
      const response = await fetch("api/scripts", { cache: "no-store", headers: launcherTag ? { "If-None-Match": launcherTag } : {} });
      if (response.status === 304) return true; // nothing changed
      if (!response.ok) return false;
      launcherTag = response.headers.get("ETag") || "";
      const data = await response.json();
      if (!data || !Array.isArray(data.scripts)) return false;
      folder.mode = "launcher";
      folder.label = "";
      folder.movedFrom = Number(data.movedFrom) || 0;
      setFolderScripts(
        data.scripts
          .filter((s) => typeof s.file === "string" && typeof s.text === "string")
          .map((s) => ({ name: stripExtension(s.file), text: s.text, mtime: Number(s.mtime) || 0 }))
      );
      return true;
    } catch {
      return false;
    }
  }

  /** Reads a folder the user linked with the browser's folder picker. */
  // Text of files already read, so each check only reads the files that changed.
  const fileCache = new Map();
  let readingFolder = false;

  async function readLinkedFolder() {
    if (!folder.handle || readingFolder) return;
    readingFolder = true;
    try {
      const list = [];
      for await (const [name, entry] of folder.handle.entries()) {
        if (list.length >= MAX_FOLDER_FILES) break;
        if (entry.kind !== "file" || !TEXT_FILE.test(name) || /^[.~]/.test(name)) continue;
        const file = await entry.getFile();
        if (file.size > MAX_SCRIPT_BYTES) continue;
        const stamp = `${file.lastModified}:${file.size}`;
        if (fileCache.get(name)?.stamp !== stamp) fileCache.set(name, { stamp, text: await file.text() });
        list.push({ name: stripExtension(name), text: fileCache.get(name).text, mtime: file.lastModified });
      }
      list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      folder.label = folder.handle.name;
      setFolderScripts(list);
    } catch {
      folder.mode = "none";
      folder.handle = null;
      changes.emit({ kind: "folder", added: [], updated: [] });
    } finally {
      readingFolder = false;
    }
  }

  /** Lets the user pick a folder to watch. Returns true if one was linked. */
  async function linkFolder() {
    if (!canLinkFolder()) {
      toast("Linking a folder needs Edge or Chrome.");
      return false;
    }
    try {
      folder.handle = await window.showDirectoryPicker({ mode: "read" });
    } catch {
      return false; // the user closed the picker
    }
    folder.mode = "linked";
    folder.signature = "";
    fileCache.clear();
    await rememberHandle(folder.handle);
    await readLinkedFolder();
    return true;
  }

  /** Reconnects the folder linked last time, asking for permission again if needed. */
  async function reconnectFolder({ ask = true } = {}) {
    const handle = await recallHandle();
    if (!handle) return false;
    try {
      let permission = await handle.queryPermission({ mode: "read" });
      if (permission !== "granted" && ask) permission = await handle.requestPermission({ mode: "read" });
      if (permission !== "granted") return false;
    } catch {
      return false;
    }
    folder.handle = handle;
    folder.mode = "linked";
    await readLinkedFolder();
    return true;
  }

  /** Opens the launcher's Scripts folder in the file manager. */
  function revealLauncherFolder() {
    fetch("api/open-folder", { method: "POST" })
      .then((response) => toast(response.ok ? "Opening your Scripts folder" : "Couldn’t open the folder."))
      .catch(() => toast("Couldn’t open the folder."));
  }

  /** Starts watching for changes: the launcher every 2 seconds, a linked folder every 3. */
  async function startWatching() {
    // The launcher only ever runs on this computer, so there's no point asking anywhere else.
    const fromLauncher = ["127.0.0.1", "localhost"].includes(location.hostname);
    if (fromLauncher && (await pollLauncher())) {
      setInterval(pollLauncher, 2000);
      return;
    }
    if (canLinkFolder()) await reconnectFolder({ ask: false });
    setInterval(() => folder.mode === "linked" && readLinkedFolder(), 3000);
  }

  /* The linked folder's handle lives in IndexedDB, since localStorage cannot hold it. */
  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("plexo-prompter", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("kv");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async function rememberHandle(handle) {
    try {
      const db = await openDatabase();
      db.transaction("kv", "readwrite").objectStore("kv").put(handle, "folder");
    } catch {
      /* the folder simply won't be remembered */
    }
  }
  async function recallHandle() {
    try {
      const db = await openDatabase();
      return await new Promise((resolve) => {
        const request = db.transaction("kv").objectStore("kv").get("folder");
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => resolve(null);
      });
    } catch {
      return null;
    }
  }

  /* ---------- lookups ---------- */

  function find(id) {
    if (!id) return null;
    return saved.find((s) => s.id === id) || folder.scripts.find((s) => s.id === id) || samples.find((s) => s.id === id) || null;
  }

  /** Imports text files the user chose or dropped. Returns the scripts added. */
  async function importFiles(fileList) {
    const files = Array.from(fileList).filter((f) => TEXT_FILE.test(f.name) || f.type.startsWith("text/"));
    const added = [];
    for (const file of files) {
      if (file.size > MAX_SCRIPT_BYTES) {
        toast(`${file.name} is too large for a script.`);
        continue;
      }
      added.push(add(stripExtension(file.name), await file.text()));
    }
    return { added, ignored: fileList.length - files.length };
  }

  /** Saves a script to the user's Downloads as a .txt file. */
  function download(script) {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([script.text.replace(/\r?\n/g, "\r\n")], { type: "text/plain" }));
    link.download = `${script.name.replace(/[\\/:*?"<>|]/g, "-")}.txt`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 2000);
  }

  Plexo.library = {
    /** Saved scripts, most recently opened or edited first. */
    all: () => saved.slice().sort(byRecent),
    /** The start screen's Recent list: the same order, minus scripts taken off it since they were last used. */
    recent: (limit = Infinity) => saved.filter(inRecent).sort(byRecent).slice(0, limit),
    count: () => saved.length,
    add, save, rename, duplicate, remove, markOpened, removeFromRecent, find, importFiles, download,
    tutorial,
    folder: () => folder,
    folderAvailable: () => folder.mode !== "none" || canLinkFolder(),
    linkFolder, reconnectFolder, revealLauncherFolder, startWatching,
    onChange: changes.on,
  };
})(window.Plexo);
