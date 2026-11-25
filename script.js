(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const video = $("video");
  const state = {
    stream: null, facing: "user", format: "single", photos: [], activePhoto: 0,
    busy: false, stage: "capture", settings: null
  };

  const defaults = {
    filter: "none", brightness: 100, contrast: 100, saturation: 100, grain: 12,
    borderWidth: 20, spacing: 12, borderColor: "#fffaf0", backgroundColor: "#e8dfcf",
    captionText: "", dateStamp: false, decorations: false, stripTemplate: "classic"
  };

  const settingIds = Object.keys(defaults);
  const imageFromCanvas = (canvas) => new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.src = canvas.toDataURL("image/png");
  });

  function setStage(stage) {
    state.stage = stage;
    ["capture", "customize", "download"].forEach((name) => {
      $(name + "Stage").hidden = name !== stage;
      const step = document.querySelector(`.step[data-stage="${name}"]`);
      step.classList.toggle("active", name === stage);
      step.disabled = name !== "capture" && state.photos.length === 0;
    });
    if (stage === "customize") renderPreview();
    if (stage === "download") renderFinal();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function settings() {
    const s = {};
    settingIds.forEach((key) => {
      const el = $(key);
      if (el) s[key] = el.type === "checkbox" ? el.checked :
        (el.type === "range" ? Number(el.value) : el.value);
    });
    return s;
  }

  function updateOutputs() {
    ["brightness", "contrast", "saturation", "grain"].forEach((key) => {
      $(key + "Out").value = $(key).value + (key === "grain" ? "%" : "%");
      $(key + "Out").textContent = $(key).value + "%";
    });
  }

  function filterString(s) {
    const extras = {
      bw: "grayscale(1)", sepia: "sepia(.85)", faded: "sepia(.22) saturate(.72) brightness(1.08) contrast(.86)",
      warm: "sepia(.22) saturate(1.18)", cool: "hue-rotate(12deg) saturate(.88)",
      retro: "sepia(.35) saturate(1.25) contrast(.92)", washed: "saturate(.62) brightness(1.12) contrast(.82)"
    };
    return `brightness(${s.brightness}%) contrast(${s.contrast}%) saturate(${s.saturation}%) ${extras[s.filter] || ""}`;
  }

  function drawFilteredPhoto(ctx, photo, x, y, w, h, s) {
    ctx.save();
    ctx.filter = filterString(s);
    ctx.drawImage(photo, x, y, w, h);
    ctx.restore();
    if (s.grain > 0) {
      // A small, low-resolution noise layer keeps mobile rendering responsive.
      const gw = Math.max(80, Math.min(220, Math.round(w / 4)));
      const gh = Math.max(80, Math.min(220, Math.round(h / 4)));
      const noise = document.createElement("canvas");
      noise.width = gw; noise.height = gh;
      const nctx = noise.getContext("2d");
      const data = nctx.createImageData(gw, gh);
      for (let i = 0; i < data.data.length; i += 4) {
        const v = 100 + Math.random() * 155;
        data.data[i] = data.data[i + 1] = data.data[i + 2] = v;
        data.data[i + 3] = Math.round(s.grain * .65);
      }
      nctx.putImageData(data, 0, 0);
      ctx.save(); ctx.globalCompositeOperation = "soft-light";
      ctx.drawImage(noise, x, y, w, h); ctx.restore();
    }
  }

  function drawSingle(canvas, photo, s) {
    const maxSide = 1800;
    const scale = Math.min(1, maxSide / Math.max(photo.width, photo.height));
    const w = Math.round(photo.width * scale), h = Math.round(photo.height * scale);
    const border = s.borderWidth * 2;
    canvas.width = w + border * 2;
    canvas.height = h + border * 2 + (s.captionText || s.dateStamp ? 48 : 0);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = s.borderColor; ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawFilteredPhoto(ctx, photo, border, border, w, h, s);
    drawPrintDetails(ctx, canvas, s, border, h);
  }

  function drawStrip(canvas, photos, s) {
    const count = photos.length;
    const maxW = 760;
    const first = photos[0];
    const ratio = first.width / first.height;
    const imageW = Math.min(maxW, 620);
    const imageH = Math.round(imageW / ratio);
    const border = s.borderWidth * 2;
    const gap = s.stripTemplate === "compact" ? Math.round(s.spacing * .45) :
      (s.stripTemplate === "spaced" ? Math.round(s.spacing * 1.7) : s.spacing);
    const footer = (s.captionText || s.dateStamp) ? 58 : 15;
    canvas.width = imageW + border * 2;
    canvas.height = count * imageH + (count - 1) * gap + border * 2 + footer;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = s.backgroundColor; ctx.fillRect(0, 0, canvas.width, canvas.height);
    photos.forEach((photo, i) => {
      const y = border + i * (imageH + gap);
      ctx.fillStyle = s.borderColor; ctx.fillRect(border - 4, y - 4, imageW + 8, imageH + 8);
      drawFilteredPhoto(ctx, photo, border, y, imageW, imageH, s);
    });
    drawPrintDetails(ctx, canvas, s, border, count * imageH + (count - 1) * gap);
  }

  function drawPrintDetails(ctx, canvas, s, border, imageAreaHeight) {
    const footerTop = border + imageAreaHeight + 4;
    ctx.textAlign = "center";
    if (s.captionText) {
      ctx.fillStyle = s.filter === "bw" ? "#333" : "#665849";
      ctx.font = "italic 24px Georgia";
      ctx.fillText(s.captionText, canvas.width / 2, footerTop + 29, canvas.width - 30);
    }
    if (s.dateStamp) {
      ctx.fillStyle = "#766b5e"; ctx.font = "11px monospace";
      const date = new Date().toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
      ctx.fillText(date, canvas.width / 2, canvas.height - 13);
    }
    if (s.decorations) {
      ctx.fillStyle = "#a65e45"; ctx.font = "18px Georgia";
      ctx.fillText("✳  ·  ✳", canvas.width / 2, Math.max(20, footerTop + 49));
    }
  }

  function makeCanvas() {
    const canvas = document.createElement("canvas");
    if (state.format === "strip") drawStrip(canvas, state.photos, settings());
    else drawSingle(canvas, state.photos[0], settings());
    return canvas;
  }

  function renderPreview() {
    if (!state.photos.length) return;
    const canvas = $("previewCanvas");
    if (state.format === "strip") drawStrip(canvas, state.photos, settings());
    else drawSingle(canvas, state.photos[0], settings());
    $("previewDimensions").textContent = `${canvas.width} × ${canvas.height} PX`;
    renderPhotoNavigation();
  }

  function renderFinal() {
    if (!state.photos.length) return;
    const source = makeCanvas();
    const target = $("finalCanvas");
    target.width = source.width; target.height = source.height;
    target.getContext("2d").drawImage(source, 0, 0);
  }

  function renderPhotoNavigation() {
    const nav = $("photoNavigation");
    const strip = state.format === "strip";
    nav.hidden = !strip;
    $("stripTools").hidden = !strip;
    nav.replaceChildren();
    if (!strip) return;
    state.photos.forEach((_, index) => {
      const wrap = document.createElement("span");
      const select = document.createElement("button");
      select.textContent = `Frame ${index + 1}`;
      select.className = index === state.activePhoto ? "current" : "";
      select.addEventListener("click", () => { state.activePhoto = index; renderPhotoNavigation(); });
      const up = document.createElement("button");
      up.textContent = "↑"; up.title = "Move frame earlier"; up.disabled = index === 0;
      up.addEventListener("click", () => movePhoto(index, -1));
      const down = document.createElement("button");
      down.textContent = "↓"; down.title = "Move frame later"; down.disabled = index === state.photos.length - 1;
      down.addEventListener("click", () => movePhoto(index, 1));
      const retake = document.createElement("button");
      retake.textContent = "Retake"; retake.addEventListener("click", () => retakePhoto(index));
      wrap.append(select, up, down, retake); nav.append(wrap);
    });
  }

  function movePhoto(index, direction) {
    const target = index + direction;
    if (target < 0 || target >= state.photos.length) return;
    [state.photos[index], state.photos[target]] = [state.photos[target], state.photos[index]];
    state.activePhoto = target; renderPreview();
  }

  async function startCamera() {
    $("cameraError").textContent = "";
    if (!navigator.mediaDevices?.getUserMedia) {
      $("cameraError").textContent = "Camera access is not available here. Open this page on localhost or HTTPS in a supported browser.";
      return;
    }
    stopCamera();
    $("startCamera").disabled = true;
    $("startCamera").textContent = "Connecting…";
    try {
      state.facing = $("cameraSelect").value;
      state.stream = await navigator.mediaDevices.getUserMedia({
        audio: false, video: { facingMode: { ideal: state.facing }, width: { ideal: 1920 }, height: { ideal: 1080 } }
      });
      video.srcObject = state.stream;
      await video.play();
      const track = state.stream.getVideoTracks()[0];
      const actual = track.getSettings().facingMode;
      video.classList.toggle("rear", actual === "environment" || state.facing === "environment");
      $("cameraPlaceholder").hidden = true;
      $("cameraStatus").textContent = "CAMERA CONNECTED";
      $("captureButton").disabled = false;
      $("startCamera").textContent = "Reconnect camera";
    } catch (error) {
      const messages = {
        NotAllowedError: "Camera permission was denied. Allow camera access in your browser settings, then try again.",
        NotFoundError: "No camera was found. Connect a webcam or try another device.",
        NotReadableError: "Your camera may be in use by another app. Close it and try again."
      };
      $("cameraError").textContent = messages[error.name] || "Could not start the camera. Check your browser permissions and try again.";
      $("cameraPlaceholder").hidden = false;
      $("cameraStatus").textContent = "CAMERA NOT CONNECTED";
      $("startCamera").textContent = "Enable camera";
    } finally { $("startCamera").disabled = false; }
  }

  function stopCamera() {
    if (state.stream) state.stream.getTracks().forEach((track) => track.stop());
    state.stream = null; video.srcObject = null;
  }

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  async function countdown(seconds) {
    const el = $("countdown");
    for (let n = seconds; n > 0; n--) {
      el.textContent = n; el.hidden = false; await wait(1000);
    }
    el.hidden = true;
  }

  function takeSnapshot() {
    const canvas = document.createElement("canvas");
    const width = video.videoWidth || 1280, height = video.videoHeight || 720;
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (state.facing === "user") { ctx.translate(width, 0); ctx.scale(-1, 1); }
    ctx.drawImage(video, 0, 0, width, height);
    return canvas;
  }

  async function capture() {
    if (state.busy || !state.stream) return;
    state.busy = true; $("captureButton").disabled = true;
    const count = state.format === "strip" ? Number($("shotCount").value) : 1;
    const delay = Number($("timer").value);
    const captured = [];
    try {
      for (let i = 0; i < count; i++) {
        $("captureLabel").textContent = state.format === "strip" ? `Frame ${i + 1} of ${count}` : "Get ready…";
        await countdown(delay);
        const flash = $("flash");
        flash.classList.remove("fire"); void flash.offsetWidth; flash.classList.add("fire");
        captured.push(await imageFromCanvas(takeSnapshot()));
        if (i < count - 1) await wait(550);
      }
      state.photos = captured; state.activePhoto = 0;
      await saveMemory(makeCanvas(), state.format === "strip" ? "Original photo strip" : "Original photo");
      setStage("customize");
    } catch (error) {
      $("cameraError").textContent = "Something went wrong while capturing. Please try again.";
    } finally {
      state.busy = false; $("captureButton").disabled = !state.stream;
      $("captureLabel").textContent = "Take a photo";
    }
  }

  async function retakePhoto(index) {
    if (!state.stream || state.busy) {
      $("cameraError").textContent = "Reconnect your camera before retaking a frame.";
      return;
    }
    state.busy = true;
    $("captureStage").hidden = false;
    setStage("capture");
    await countdown(Number($("timer").value));
    const flash = $("flash"); flash.classList.remove("fire"); void flash.offsetWidth; flash.classList.add("fire");
    state.photos[index] = await imageFromCanvas(takeSnapshot());
    state.activePhoto = index;
    state.busy = false;
    setStage("customize");
  }

  function resetEdits() {
    Object.entries(defaults).forEach(([key, value]) => {
      const el = $(key); if (!el) return;
      if (el.type === "checkbox") el.checked = value;
      else el.value = value;
    });
    updateOutputs(); renderPreview();
  }

  function newSession() {
    state.photos = []; state.activePhoto = 0; state.busy = false;
    stopCamera();
    $("cameraPlaceholder").hidden = false;
    $("cameraStatus").textContent = "CAMERA NOT CONNECTED";
    $("captureButton").disabled = true;
    $("startCamera").textContent = "Enable camera";
    $("cameraError").textContent = "";
    resetEdits(); setStage("capture");
  }

  function download() {
    const canvas = $("finalCanvas");
    const mime = $("fileFormat").value;
    const extension = mime === "image/jpeg" ? "jpg" : "png";
    canvas.toBlob((blob) => {
      if (!blob) { alert("Could not export this image. Please try PNG instead."); return; }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `little-booth-${Date.now()}.${extension}`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, mime, .94);
  }


  // IndexedDB Memories: all images remain on this device.
  const DB_NAME = "little-booth-memories"; let memoryDB = null; let activeMemory = null; let memoryUrls = [];
  function openMemoryDB(){ if(memoryDB) return Promise.resolve(memoryDB); return new Promise((resolve,reject)=>{const r=indexedDB.open(DB_NAME,1);r.onupgradeneeded=()=>{const db=r.result;if(!db.objectStoreNames.contains("memories")){const s=db.createObjectStore("memories",{keyPath:"id",autoIncrement:true});s.createIndex("createdAt","createdAt");}};r.onsuccess=()=>{memoryDB=r.result;resolve(memoryDB)};r.onerror=()=>reject(r.error)}); }
  function canvasToBlob(canvas){return new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error("Canvas export failed")),"image/png"));}
  async function saveMemory(canvas,label){try{const db=await openMemoryDB(),blob=await canvasToBlob(canvas),record={blob,label,format:state.format,width:canvas.width,height:canvas.height,createdAt:Date.now()};await new Promise((resolve,reject)=>{const tx=db.transaction("memories","readwrite");tx.objectStore("memories").add(record);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});await refreshMemories();return true}catch(e){console.error("Memory save failed",e);return false}}
  async function allMemories(){const db=await openMemoryDB();return new Promise((resolve,reject)=>{const r=db.transaction("memories","readonly").objectStore("memories").getAll();r.onsuccess=()=>resolve(r.result.sort((a,b)=>b.createdAt-a.createdAt));r.onerror=()=>reject(r.error)});}
  async function refreshMemories(){const grid=$("memoriesGrid");if(!grid)return;memoryUrls.forEach(URL.revokeObjectURL);memoryUrls=[];grid.replaceChildren();try{const items=await allMemories();$("memoryCount").textContent=items.length;$("emptyMemories").hidden=items.length>0;items.forEach(item=>{const url=URL.createObjectURL(item.blob);memoryUrls.push(url);const card=document.createElement("button");card.className="memory-card";card.type="button";const img=document.createElement("img");img.src=url;img.alt="Saved photo";const info=document.createElement("span");info.className="memory-card-info";const title=document.createElement("strong");title.textContent=item.label||"Little memory";const date=document.createElement("small");date.textContent=new Date(item.createdAt).toLocaleString();info.append(title,date);card.append(img,info);card.addEventListener("click",()=>showMemory(item));grid.append(card)})}catch(e){console.error(e);$("emptyMemories").hidden=false;$("emptyMemories").textContent="Memories are unavailable in this browser."}}
  function showMemory(item){activeMemory=item;$("viewerImage").src=URL.createObjectURL(item.blob);$("viewerDate").textContent=(item.label||"Little memory")+" · "+new Date(item.createdAt).toLocaleString();$("memoryViewer").hidden=false}
  function hideMemory(){const src=$("viewerImage").src;if(src.startsWith("blob:"))URL.revokeObjectURL(src);$("viewerImage").removeAttribute("src");$("memoryViewer").hidden=true;activeMemory=null}
  $("openMemories").addEventListener("click",async()=>{$("memoriesOverlay").hidden=false;await refreshMemories()});$("closeMemories").addEventListener("click",()=>$("memoriesOverlay").hidden=true);$("closeViewer").addEventListener("click",hideMemory);
  $("deleteMemory").addEventListener("click",async()=>{if(!activeMemory)return;const db=await openMemoryDB();await new Promise((resolve,reject)=>{const tx=db.transaction("memories","readwrite");tx.objectStore("memories").delete(activeMemory.id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});hideMemory();await refreshMemories()});
  $("downloadMemory").addEventListener("click",()=>{if(!activeMemory)return;const u=URL.createObjectURL(activeMemory.blob),a=document.createElement("a");a.href=u;a.download=`little-booth-memory-${activeMemory.id}.png`;a.click();setTimeout(()=>URL.revokeObjectURL(u),1200)});
  $("saveToMemories").addEventListener("click",async()=>{const b=$("saveToMemories");b.disabled=true;b.textContent="Saving…";const ok=await saveMemory($("finalCanvas"),"Edited photo");b.disabled=false;b.textContent=ok?"Saved to Memories ✓":"Save to Memories ♡"});
  if(navigator.storage?.persist) navigator.storage.persist().catch(()=>{});

  document.querySelectorAll(".step").forEach((button) => {
    button.addEventListener("click", () => {
      if (!button.disabled && (button.dataset.stage === "capture" || state.photos.length)) setStage(button.dataset.stage);
    });
  });
  document.querySelectorAll("[data-format]").forEach((button) => {
    button.addEventListener("click", () => {
      state.format = button.dataset.format;
      document.querySelectorAll("[data-format]").forEach((b) => b.classList.toggle("selected", b === button));
      $("shotsBlock").hidden = state.format !== "strip";
      $("captureLabel").textContent = "Take a photo";
    });
  });
  $("startCamera").addEventListener("click", startCamera);
  $("cameraSelect").addEventListener("change", () => { if (state.stream) startCamera(); });
  $("captureButton").addEventListener("click", capture);
  $("resetEdits").addEventListener("click", resetEdits);
  $("backToCapture").addEventListener("click", () => setStage("capture"));
  $("toDownload").addEventListener("click", () => setStage("download"));
  $("editAgain").addEventListener("click", () => setStage("customize"));
  $("downloadButton").addEventListener("click", download);
  $("newSession").addEventListener("click", newSession);
  $("newSessionTop").addEventListener("click", newSession);
  $("stripTemplate").addEventListener("change", renderPreview);

  const liveControls = ["filter","brightness","contrast","saturation","grain","borderWidth","spacing","borderColor","backgroundColor","captionText","dateStamp","decorations"];
  liveControls.forEach((id) => {
    $(id).addEventListener("input", () => { updateOutputs(); renderPreview(); });
    $(id).addEventListener("change", () => { updateOutputs(); renderPreview(); });
  });
  $("stripTemplate").addEventListener("change", renderPreview);
  updateOutputs();
  window.addEventListener("pagehide", stopCamera);
})();