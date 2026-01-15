/**
 * sketch.js - Fixed Aspect Ratio & CSS Scaling
 * - Resolution is locked.
 * - Browser zooms to fit.
 * - Fixed 'renderScale' error.
 */

// --- FILE PATHS ---
const FONT_FILES = {
  HEADLINE: 'resources/ItemsTextTrial-Medium.otf',
  SUBHEAD_MEDIUM: 'resources/ABCOracle-Medium-Trial.otf'
};

let fontHeadline, fontSubheadMedium;
let imgs = [];
let nodes = [];
let camRotX = 0, camRotY = 0, camDist = 2200; 
let inputLine1, inputLine2; 
let uploadInput, exportBtn, recordBtn, exportSelect, shuffleBtn; 
let textBuffer; 
let isRecording = false;
let recorder;

// --- MISSING VARIABLE FIXED HERE ---
let renderScale = 1; 

// --- INTERNAL RESOLUTION STATE ---
// We render at these dimensions, then scale with CSS to fit the window
let targetW = 1920; 
let targetH = 1080; 

// --- TUNING KNOBS ---
let triggerFrame = -10000; 
let imageBurstStartFrame = -10000; 
const INITIAL_BLANK_FRAMES = 20; 
const WORD_REVEAL_INTERVAL = 3;  
const LINE_BREAK_PAUSE = 5;       
const PRE_BURST_PAUSE = 5;        
const STAGGER_FRAMES = 1;         
const MOVE_DURATION = 10;         
const EASE_POWER = 4;             
const MAX_DRIFT_DIST = 400;       
const DRIFT_DECAY_POWER = 2;    
const TEXT_DRIFT_SCALE = 0.15; 
const EXPANSION_BUFFER = 90;    
const IMPLODE_DURATION = 8;        
const START_Z_DEPTH = -200;       
const FIT_MARGIN_W = 0.96; 
let lastUploadTime = 0;
let layoutDebounceTimer = null;

function preload() {
  try {
    fontHeadline = loadFont(FONT_FILES.HEADLINE, 
      () => console.log("Headline loaded"),
      () => console.warn("Error: Headline font missing")
    );
    fontSubheadMedium = loadFont(FONT_FILES.SUBHEAD_MEDIUM,
      () => console.log("Subhead loaded"),
      () => console.warn("Error: Subhead font missing")
    );
  } catch (e) { console.error(e); }
}

function setup() {
  // Initialize with a default size (will be updated by applyLayout immediately)
  let c = createCanvas(windowWidth, windowHeight, WEBGL);
  pixelDensity(1);
  noStroke();
  
  // FIX: Set CSS to strictly strictly block to allow manual sizing
  c.style('display', 'block');
  c.style('position', 'absolute');
  
  textBuffer = createGraphics(windowWidth, windowHeight);
  
  if (typeof CCapture === 'undefined') {
      loadScript("https://unpkg.com/ccapture.js@1.1.0/build/CCapture.all.min.js", () => {});
  }
  
  // --- UI SETUP ---
  inputLine1 = createInput('Spice of Life');
  inputLine2 = createInput('CAROLWELLS');
  uploadInput = createFileInput(handleFileUpload, true); 
  
  exportSelect = createSelect();
  // We explicitly define resolutions here so layout is stable
  exportSelect.option('Full View (Screen)', 'window');
  exportSelect.option('Square (1080x1080)', 'square');
  exportSelect.option('Portrait (1080x1920)', 'portrait');
  exportSelect.option('Landscape (1920x1080)', 'landscape');
  exportSelect.option('Print (2400x3000)', 'print');
  
  exportSelect.changed(() => {
      // 1. Change Resolution
      applyLayoutResolution();
      // 2. Refresh Nodes (Only when user explicitly changes format)
      refreshBurstNodes(false); 
      // 3. Trigger Animation
      triggerBurst(true);
      // 4. Fit to Screen
      fitCanvasToScreen();
  });
  
  exportBtn = createButton('Save Image');
  exportBtn.mousePressed(handleExportOffscreen); 
  recordBtn = createButton('Save Video');
  recordBtn.mousePressed(handleVideoToggle);
  shuffleBtn = createButton('Shuffle');
  shuffleBtn.mousePressed(handleShuffle);

  // Initial Run
  applyLayoutResolution();
  fitCanvasToScreen(); // Scale it to fit current window
  repositionUI();
}

/**
 * 1. SETS THE INTERNAL RESOLUTION (The "Truth")
 * This sets the actual pixel dimensions of the P5 Canvas.
 * It DOES NOT look at the current browser window size unless in 'window' mode.
 */
function applyLayoutResolution() {
    if (isRecording) return; 

    let choice = exportSelect.value();
    
    if (choice === 'square') { targetW = 1080; targetH = 1080; }
    else if (choice === 'portrait') { targetW = 1080; targetH = 1920; }
    else if (choice === 'landscape') { targetW = 1920; targetH = 1080; }
    else if (choice === 'print') { targetW = 2400; targetH = 3000; }
    else { 
        // 'window' mode: Capture current screen size as the base resolution
        // We capture it ONCE. We don't update it on resize to prevent scrambling.
        targetW = windowWidth; 
        targetH = windowHeight; 
    }

    resizeCanvas(targetW, targetH);
    textBuffer.resizeCanvas(targetW, targetH);
    
    // Reset camera to default for this new aspect ratio
    resetCamera();
}

/**
 * 2. SCALES THE CANVAS TO FIT THE WINDOW (The "View")
 * This uses CSS to zoom the canvas so it fits in the browser.
 * It DOES NOT change the canvas resolution or layout.
 */
function fitCanvasToScreen() {
    let cnv = document.querySelector('canvas');
    if (!cnv) return;

    let availW = windowWidth;
    let availH = windowHeight;
    
    // Calculate aspect ratios
    let canvasRatio = targetW / targetH;
    let windowRatio = availW / availH;
    
    let cssW, cssH;

    // Fit logic (Contain)
    if (windowRatio > canvasRatio) {
        // Window is wider than canvas -> Fit to Height
        cssH = availH;
        cssW = cssH * canvasRatio;
    } else {
        // Window is taller than canvas -> Fit to Width
        cssW = availW;
        cssH = cssW / canvasRatio;
    }

    // Apply CSS
    cnv.style.width = `${cssW}px`;
    cnv.style.height = `${cssH}px`;
    
    // Center it
    cnv.style.left = `${(availW - cssW) / 2}px`;
    cnv.style.top = `${(availH - cssH) / 2}px`;
}

// --- RESIZE HANDLER ---
function windowResized() {
  if (isRecording) return;
  
  // CRITICAL FIX:
  // When window resizes, we ONLY adjust the CSS scaling (fitCanvasToScreen).
  // We do NOT call resizeCanvas() or applyLayoutResolution().
  // This ensures the images/text DO NOT MOVE or re-randomize.
  fitCanvasToScreen();
  repositionUI();
}

function resetCamera() { camRotX = 0; camRotY = 0; }

function handleShuffle() {
  if (imgs.length === 0) { alert("Please upload images first!"); return; }
  resetCamera();
  refreshBurstNodes(false);
  triggerBurst(true);
}

function triggerBurst(instant = false) {
  let words1 = inputLine1.value().trim().split(/\s+/);
  let words2 = ["curated", "by", `@${inputLine2.value()}`];
  let timeForLine1 = (words1.length * WORD_REVEAL_INTERVAL);
  let timeForLine2 = (words2.length * WORD_REVEAL_INTERVAL);
  let totalIntroTime = INITIAL_BLANK_FRAMES + timeForLine1 + LINE_BREAK_PAUSE + timeForLine2 + PRE_BURST_PAUSE;

  if (instant) {
      triggerFrame = frameCount - 10000; 
      imageBurstStartFrame = frameCount - MOVE_DURATION; 
  } else {
      triggerFrame = frameCount;
      imageBurstStartFrame = triggerFrame + totalIntroTime;
  }
}

function handleFileUpload(file) {
  if (file.type === 'image') {
    let now = millis();
    if (now - lastUploadTime > 1000) { imgs = []; nodes = []; resetCamera(); }
    lastUploadTime = now;

    loadImage(file.data, (img) => {
      let cornerRadius = min(img.width, img.height) * 0.08;
      let pg = createGraphics(img.width, img.height);
      pg.fill(255); pg.noStroke();
      pg.rect(0, 0, img.width, img.height, cornerRadius); 
      let rounded = img.get();
      rounded.mask(pg);
      imgs.push(rounded); 
      
      if (layoutDebounceTimer) clearTimeout(layoutDebounceTimer);
      layoutDebounceTimer = setTimeout(() => {
          refreshBurstNodes(false);
          triggerBurst(true);
      }, 100);
    });
  }
}

function refreshBurstNodes(isPlaceholderBatch = false) {
  nodes = []; 
  if (imgs.length === 0) return;

  // Layout logic uses targetW/targetH (the internal resolution)
  let safeW = targetW * FIT_MARGIN_W;
  let boundaryX = safeW / 2;
  let boundaryY = targetH / 2; 
  let deadLimit = (targetH * 0.15 / 2) + 30; 
  let availableVerticalStrip = boundaryY - deadLimit;
  let baseReferenceSize;
  
  if (safeW > availableVerticalStrip * 1.5) baseReferenceSize = availableVerticalStrip * 3.5; 
  else baseReferenceSize = safeW * 1.5;
  
  let maxPhysicalH = (boundaryY - deadLimit) - 10; 
  let padding = 10; 
  let candidates = [];
  let indices = imgs.map((_, i) => i);
  
  for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
  }

  for (let i of indices) {
      let img = imgs[i];
      let ratio = img.width / img.height;
      let isHero = (candidates.length < 2); 
      let baseSize = isHero ? baseReferenceSize * random(2.0, 3.0) : baseReferenceSize * random(0.5, 1.2);
      baseSize *= random(0.85, 1.15);

      let w, h;
      if (ratio >= 1) { w = baseSize; h = w / ratio; }
      else { h = baseSize; w = h * ratio; }

      if (h > maxPhysicalH) { h = maxPhysicalH; w = h * ratio; }
      if (w > safeW - 20) { w = safeW - 20; h = w / ratio; }

      candidates.push({ img, w, h, ratio, area: w * h, isHero, id: i });
  }

  candidates.sort((a, b) => b.area - a.area);
  let placedNodes = [];
  let topCount = 0, bottomCount = 0;

  for (let cand of candidates) {
      let placed = false;
      let currentScale = 1.0;
      
      while (!placed && currentScale > 0.2) {
          let w = cand.w * currentScale;
          let h = cand.h * currentScale;
          let maxAttempts = 500; 
          for (let attempt = 0; attempt < maxAttempts; attempt++) {
              let safeRx = Math.max(0, boundaryX - (w/2) - padding);
              let rx = random(-safeRx, safeRx);
              let validYMax_Top = -deadLimit - (h/2) - padding;        
              let validYMin_Top = -boundaryY + (h/2);                  
              let validYMin_Bottom = deadLimit + (h/2) + padding;      
              let validYMax_Bottom = boundaryY - (h/2);                

              let validTop = (validYMax_Top > validYMin_Top);
              let validBottom = (validYMax_Bottom > validYMin_Bottom);
              if (!validTop && !validBottom) break; 

              let tryTop;
              if (topCount < bottomCount) tryTop = true;
              else if (bottomCount < topCount) tryTop = false;
              else tryTop = (random() > 0.5);

              if (tryTop && !validTop) tryTop = false;
              if (!tryTop && !validBottom) tryTop = true;

              let ry;
              if (tryTop) {
                  let t = random(); t = t * t * t; 
                  ry = lerp(validYMin_Top, validYMax_Top, t);
              } else {
                  let t = random(); t = t * t * t; 
                  ry = lerp(validYMax_Bottom, validYMin_Bottom, t);
              }

              let isInvalid = false;
              let myL = rx - w/2, myR = rx + w/2, myT = ry - h/2, myB = ry + h/2;

              for (let other of placedNodes) {
                  let otherL = other.x - other.w/2, otherR = other.x + other.w/2;
                  let otherT = other.y - other.h/2, otherB = other.y + other.h/2;

                  if (Math.abs(other.x - rx) < 15) { isInvalid = true; break; }
                  if (Math.abs(other.y - ry) < 15) { isInvalid = true; break; }

                  let overlapW = Math.min(myR, otherR) - Math.max(myL, otherL);
                  let overlapH = Math.min(myB, otherB) - Math.max(myT, otherT);

                  if (overlapW > 0 && overlapH > 0) {
                      let area1 = w * h, area2 = other.w * other.h;
                      let sizeRatio = Math.min(area1, area2) / Math.max(area1, area2);
                      if (sizeRatio > 0.4) { isInvalid = true; break; }
                      else {
                          let overlapArea = overlapW * overlapH;
                          let minArea = Math.min(area1, area2);
                          if (overlapArea / minArea > 0.60) { isInvalid = true; break; }
                      }
                  }
              }

              if (!isInvalid) {
                  placedNodes.push({
                      img: cand.img, w: w, h: h, x: rx, y: ry,
                      targetPos: createVector(rx, ry, 0),
                      startTime: frameCount, isPlaceholder: isPlaceholderBatch
                  });
                  if (ry < 0) topCount++; else bottomCount++;
                  placed = true;
                  break; 
              }
          }
          if (!placed) currentScale -= 0.05; 
      }
  }
  nodes = placedNodes;
  let zSpacing = 5;
  let startZ = -(nodes.length * zSpacing / 2);
  for(let i = 0; i < nodes.length; i++) nodes[i].targetPos.z = startZ + (i * zSpacing);
}

function renderScene(pg, txtLayer, w, h, s) { 
  pg.background('#E9EBE6'); 
  pg.perspective(PI / 3.0, w / h, 0.1, 15000);
  pg.push();
  pg.camera(0, 0, camDist, 0, 0, 0, 0, 1, 0); 
  pg.rotateX(camRotX); pg.rotateY(camRotY);

  let lastItemArrival = ((nodes.length - 1) * STAGGER_FRAMES) + MOVE_DURATION;
  let startImplodeFrame = lastItemArrival + EXPANSION_BUFFER;
  let rawTime = frameCount - imageBurstStartFrame;
  let isPreviewMode = (triggerFrame < 0);
  let isReversing = !isPreviewMode && (rawTime > startImplodeFrame);
  let globalDriftTime = Math.max(0, rawTime - 5); 
  let driftOffset = 0;
  let currentTextScale = 1.0; 
  let currentTextAlpha = 255; 

  if (!isReversing) {
      let driftProgress = constrain(globalDriftTime / (lastItemArrival + EXPANSION_BUFFER), 0, 1);
      let driftEase = 1 - Math.pow(1 - driftProgress, DRIFT_DECAY_POWER);
      driftOffset = driftEase * MAX_DRIFT_DIST;
      currentTextScale = 1.0 + (driftEase * TEXT_DRIFT_SCALE);
  } else {
      let timeSinceTrigger = rawTime - startImplodeFrame;
      let progress = constrain(timeSinceTrigger / IMPLODE_DURATION, 0, 1);
      let t = 1 - progress; 
      let totalDriftPossibleTime = startImplodeFrame - MOVE_DURATION;
      let maxDriftProgress = constrain(totalDriftPossibleTime / (lastItemArrival + EXPANSION_BUFFER), 0, 1);
      let maxDriftEase = 1 - Math.pow(1 - maxDriftProgress, DRIFT_DECAY_POWER);
      let frozenDriftVal = maxDriftEase * MAX_DRIFT_DIST;
      driftOffset = frozenDriftVal * t; 
      currentTextScale = 1.0 + (maxDriftEase * t * TEXT_DRIFT_SCALE);
      if (t <= 0) currentTextAlpha = 0;
  }

  for (let i = 0; i < nodes.length; i++) {
    let n = nodes[i];
    let t = 0;
    let staggerDelay = i * STAGGER_FRAMES;
    if (!isReversing) {
        let activeTime = rawTime - staggerDelay;
        if (activeTime < 0) continue; 
        t = constrain(activeTime / MOVE_DURATION, 0, 1);
    } else {
        let timeSinceTrigger = rawTime - startImplodeFrame;
        let progress = constrain(timeSinceTrigger / IMPLODE_DURATION, 0, 1);
        t = 1 - progress; 
    }
    if (t <= 0 && isReversing) continue;

    pg.push();
    let ease = 1 - Math.pow(1 - t, EASE_POWER);
    // Use targetW/targetH relative coords
    let curX = n.targetPos.x * s; 
    let curY = n.targetPos.y * s;
    let snapZ = lerp(START_Z_DEPTH, n.targetPos.z * s, ease);
    let curZ = snapZ + driftOffset;
    pg.translate(curX, curY, curZ);
    pg.rotateY(-camRotY); pg.rotateX(-camRotX);
    pg.texture(n.img);
    pg.rect((-n.w/2)*s, (-n.h/2)*s, n.w*s, n.h*s); 
    pg.pop();
  }
  pg.pop(); 
  if (triggerFrame < 0) currentTextScale = 1.0;
  drawEditorialHeadline(pg, txtLayer, w, h, s, triggerFrame, currentTextScale, currentTextAlpha);
}

function draw() {
  // Use targetW, targetH for rendering. renderScale is normally 1.
  renderScene(this, textBuffer, targetW, targetH, renderScale);
  if (recorder && isRecording) recorder.capture(document.querySelector('canvas'));
}

function drawEditorialHeadline(pg, buf, w, h, s, startFrame, scaleFactor, alphaVal) {
  if (alphaVal === 0) return;
  buf.clear();
  let framesPassed = frameCount - startFrame;
  let isStatic = (startFrame < 0);
  if (!isStatic && framesPassed < INITIAL_BLANK_FRAMES) return;

  let size1 = 48 * s; 
  let size2 = 44 * s; 
  let leading = ((size1 + size2) / 2) * 1.05; 
  let track1 = -1.5 * s; 
  let track2 = -2.0 * s; 
  let rawHeadline = inputLine1.value().trim();
  let words1 = rawHeadline.split(/\s+/);

  const getTightWidth = (word, tracking) => {
      let wid = 0;
      for (let i = 0; i < word.length; i++) wid += buf.textWidth(word.charAt(i)) + tracking;
      return wid;
  };
  const drawTightWord = (word, x, y, tracking) => {
      let cursor = x;
      for (let i = 0; i < word.length; i++) {
          let char = word.charAt(i);
          buf.text(char, cursor, y);
          cursor += buf.textWidth(char) + tracking;
      }
      return cursor; 
  };

  buf.fill(0);
  if (fontHeadline) buf.textFont(fontHeadline); 
  buf.textSize(size1);
  buf.textAlign(LEFT, CENTER);

  let totalW1 = 0;
  let spaceW1 = buf.textWidth(" "); 
  for (let i = 0; i < words1.length; i++) {
      totalW1 += getTightWidth(words1[i], track1);
      if (i < words1.length - 1) totalW1 += spaceW1;
  }
  
  let currentX1 = (buf.width - totalW1) / 2;
  let startY1 = buf.height/2 - (leading/2);
  let line1FinishTime = INITIAL_BLANK_FRAMES;

  for (let i = 0; i < words1.length; i++) {
      let wordTrigger = INITIAL_BLANK_FRAMES + (i * WORD_REVEAL_INTERVAL);
      line1FinishTime = wordTrigger + WORD_REVEAL_INTERVAL;
      let w = getTightWidth(words1[i], track1);
      if (isStatic || framesPassed > wordTrigger) drawTightWord(words1[i], currentX1, startY1, track1);
      currentX1 += w + spaceW1; 
  }

  let words2 = ["curated", "by", `@${inputLine2.value()}`];
  buf.textSize(size2);
  let startY2 = buf.height/2 + (leading/2);
  let totalW2 = 0;
  
  for(let i = 0; i < words2.length; i++) {
      let isHeroFont = (i < 2); 
      if (fontHeadline && fontSubheadMedium) {
          if (isHeroFont) buf.textFont(fontHeadline);
          else buf.textFont(fontSubheadMedium);
      }
      totalW2 += getTightWidth(words2[i], track2);
      if (i < words2.length - 1) totalW2 += buf.textWidth(" ");
  }

  let currentX2 = (buf.width - totalW2) / 2;
  let line2StartTime = line1FinishTime + LINE_BREAK_PAUSE;
  
  for(let i = 0; i < words2.length; i++) {
      let wordTrigger = line2StartTime + (i * WORD_REVEAL_INTERVAL);
      let isHeroFont = (i < 2); 
      if (fontHeadline && fontSubheadMedium) {
        if (isHeroFont) buf.textFont(fontHeadline);
        else buf.textFont(fontSubheadMedium);
      }
      let w = getTightWidth(words2[i], track2);
      let space = buf.textWidth(" ");
      if (isStatic || framesPassed > wordTrigger) drawTightWord(words2[i], currentX2, startY2, track2);
      currentX2 += w + space;
  }

  pg.push();
  pg.resetMatrix();
  pg.ortho(-w/2, w/2, -h/2, h/2, -1000, 1000);
  pg.scale(scaleFactor);
  pg.tint(255, alphaVal);
  pg.imageMode(CENTER);
  pg.image(buf, 0, 0);
  pg.pop();
}

function handleExportOffscreen() {
  let choice = exportSelect.value();
  let tw = (choice === 'portrait' || choice === 'square') ? 1080 : 1920;
  let th = (choice === 'portrait') ? 1920 : (choice === 'landscape' || choice === 'square') ? 1080 : 3000;
  if (choice === 'window') { tw = windowWidth; th = windowHeight; }
  
  let pg = createGraphics(tw, th, WEBGL);
  let pgText = createGraphics(tw, th);
  pg.pixelDensity(1); pgText.pixelDensity(1);
  
  let scaleRatio = tw / targetW;
  
  renderScene(pg, pgText, tw, th, scaleRatio);
  
  let dataUrl = pg.canvas.toDataURL("image/png");
  let a = document.createElement('a');
  a.download = 'editorial_burst.png';
  a.href = dataUrl;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  pg.remove(); pgText.remove();
}

function startVideoExport() {
    if (nodes.length === 0) { alert("⚠️ Please upload images first!"); return; }
    if (typeof CCapture === 'undefined') { alert("Video engine loading..."); return; }
    
    // Switch to export resolution temporarily
    applyLayoutResolution();
    fitCanvasToScreen(); 
    resetCamera(); 
    triggerBurst(false); 
    
    isRecording = true;
    try {
        recorder = new CCapture({ format: 'webm', framerate: 30 });
        recorder.start();
        recordBtn.html("Recording..."); recordBtn.style('color', 'red');
        
        let words1 = inputLine1.value().trim().split(/\s+/);
        let words2 = ["curated", "by", `@${inputLine2.value()}`];
        let introDuration = INITIAL_BLANK_FRAMES + (words1.length * WORD_REVEAL_INTERVAL) + LINE_BREAK_PAUSE + (words2.length * WORD_REVEAL_INTERVAL) + PRE_BURST_PAUSE;
        let lastItemArrival = ((nodes.length - 1) * STAGGER_FRAMES) + MOVE_DURATION;
        let startImplodeFrame = lastItemArrival + EXPANSION_BUFFER;
        let endFrame = startImplodeFrame + IMPLODE_DURATION;
        let totalFrames = introDuration + endFrame + 15; 
        let ms = (totalFrames / 30) * 1000;
        setTimeout(() => { if(isRecording) stopVideoExport(); }, ms + 500); 
    } catch(e) { isRecording = false; alert("Recording failed."); stopVideoExport(); }
}

function stopVideoExport() {
    if(recorder) {
        recorder.stop(); recorder.save(); isRecording = false;
        recordBtn.html("Save Video"); recordBtn.style('color', '#000'); 
    }
}
function handleVideoToggle() { if (isRecording) stopVideoExport(); else startVideoExport(); }

function repositionUI() {
  const margin = 20;
  let uiY = windowHeight - 100;
  let uiY2 = windowHeight - 60;
  if (uiY < 100) { uiY = 20; uiY2 = 60; }
  const colWidth = 180;
  styleUI(inputLine1, margin, uiY, colWidth);
  styleUI(inputLine2, margin, uiY2, colWidth);
  styleUI(uploadInput, margin + colWidth + 10, uiY, colWidth);
  styleUI(exportSelect, margin + colWidth + 10, uiY2, colWidth);
  let btnX = margin + (colWidth * 2) + 20;
  styleUI(exportBtn, btnX, uiY, 120);
  styleUI(recordBtn, btnX, uiY2, 120);
  styleUI(shuffleBtn, btnX + 130, uiY, 80);
}

function handleCameraDrag() { camRotY += (mouseX - pmouseX) * 0.005; camRotX += (mouseY - pmouseY) * 0.005; }
function mousePressed() { if (mouseY < windowHeight - 120) isDragging = true; }
function mouseReleased() { isDragging = false; }
function styleUI(elt, x, y, w) { 
    elt.position(x, y); elt.style('width', w + 'px'); 
    elt.style('position', 'absolute'); elt.style('z-index', '10');
}
function loadScript(url, callback){
    var script = document.createElement("script");
    script.type = "text/javascript";
    script.onload = function(){ callback(); };
    script.src = url;
    document.getElementsByTagName("head")[0].appendChild(script);
}
