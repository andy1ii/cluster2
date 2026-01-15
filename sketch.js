/**
 * sketch.js - Responsive Editorial Sequential Burst
 * GITHUB COMPATIBLE VERSION
 */

const FONT_FILES = {
  HEADLINE: 'resources/ItemsTextTrial-Medium.otf',
  SUBHEAD_MEDIUM: 'resources/ABCOracle-Medium-Trial.otf'
};

let fontHeadline, fontSubheadMedium;
let imgs = [];
let nodes = [];
let camRotX = 0, camRotY = 0, camDist = 2200; 
let prevMouseX, prevMouseY, isDragging = false;

let inputLine1, inputLine2; 
let uploadInput, exportBtn, recordBtn, exportSelect, shuffleBtn; 
let textBuffer; 

// Video/Export State
let isRecording = false;
let recorder;
let renderScale = 1; 

// --- TUNING KNOBS ---
let triggerFrame = -10000; 
let imageBurstStartFrame = -10000; 

// 0. INTRO TIMING
const INITIAL_BLANK_FRAMES = 20; 
const WORD_REVEAL_INTERVAL = 3;  
const LINE_BREAK_PAUSE = 5;       
const PRE_BURST_PAUSE = 5;        

// 1. BURST TIMING (RAPID FIRE)
const STAGGER_FRAMES = 1;         
const MOVE_DURATION = 10;         
const EASE_POWER = 4;             

// 2. DRIFT PHYSICS
const MAX_DRIFT_DIST = 400;       
const DRIFT_DECAY_POWER = 2;    
const TEXT_DRIFT_SCALE = 0.15; 

// 3. CYCLE TIMING
const EXPANSION_BUFFER = 90;    
const IMPLODE_DURATION = 8;        

// 4. PERSPECTIVE LOGIC
const START_Z_DEPTH = -200;       

// 5. SAFETY MARGIN
const FIT_MARGIN_W = 0.96; 

// --- BATCH UPLOAD STATE ---
let lastUploadTime = 0;
let layoutDebounceTimer = null;
let resizeTimer = null; // New timer for smoother resizing

function preload() {
  // We use try/catch logic internally by p5, but ensure paths are correct
  fontHeadline = loadFont(FONT_FILES.HEADLINE);
  fontSubheadMedium = loadFont(FONT_FILES.SUBHEAD_MEDIUM);
}

function setup() {
  // Create canvas to fill window initially
  let c = createCanvas(windowWidth, windowHeight, WEBGL);
  pixelDensity(1);
  noStroke();
  
  // FIX: Force CSS on the canvas element strictly
  c.style('display', 'block');
  c.style('position', 'absolute');
  c.style('top', '0');
  c.style('left', '0');
  c.style('z-index', '0'); // Behind UI
  
  textBuffer = createGraphics(windowWidth, windowHeight);
  
  if (typeof CCapture === 'undefined') {
      loadScript("https://unpkg.com/ccapture.js@1.1.0/build/CCapture.all.min.js", () => {
          console.log("CCapture loaded dynamically.");
      });
  }
  
  inputLine1 = createInput('Spice of Life');
  inputLine2 = createInput('CAROLWELLS');
  uploadInput = createFileInput(handleFileUpload, true); 
  
  exportSelect = createSelect();
  exportSelect.option('Full View', 'window');
  exportSelect.option('Square (1080x1080)', 'square');
  exportSelect.option('Portrait (1080x1920)', 'portrait');
  exportSelect.option('Landscape (1920x1080)', 'landscape');
  exportSelect.option('Print (2400x3000)', 'print');
  exportSelect.changed(() => {
      applyLayout();
      refreshBurstNodes(false); 
      triggerBurst(true);
  });
  
  exportBtn = createButton('Save Image');
  exportBtn.mousePressed(handleExportOffscreen); 
  
  recordBtn = createButton('Save Video');
  recordBtn.mousePressed(handleVideoToggle);

  shuffleBtn = createButton('Shuffle');
  shuffleBtn.mousePressed(handleShuffle);

  // Initial Layout
  applyLayout();
  repositionUI();
}

function applyLayout() {
    if (isRecording) return; 

    let choice = exportSelect.value();
    let targetRatio = 1.77; 

    if (choice === 'square') targetRatio = 1;
    if (choice === 'portrait') targetRatio = 1080 / 1920;
    if (choice === 'landscape') targetRatio = 1920 / 1080;
    if (choice === 'print') targetRatio = 2400 / 3000;
    if (choice === 'window') targetRatio = windowWidth / windowHeight;

    // FIX: Subtract a small buffer to ensure UI doesn't overlap excessively on small screens
    let availableW = windowWidth;
    let availableH = windowHeight; 

    let newW = availableW;
    let newH = newW / targetRatio;

    // Fit within window if height overflows
    if (newH > availableH) {
        newH = availableH;
        newW = newH * targetRatio;
    }

    resizeCanvas(newW, newH);
    textBuffer.resizeCanvas(newW, newH);
}

function resetCamera() {
  camRotX = 0;
  camRotY = 0;
}

function handleShuffle() {
  if (imgs.length === 0) {
    alert("Please upload images first!");
    return;
  }
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
    if (now - lastUploadTime > 1000) {
        imgs = [];
        nodes = [];
        resetCamera();
    }
    lastUploadTime = now;

    loadImage(file.data, (img) => {
      let cornerRadius = min(img.width, img.height) * 0.08;
      let pg = createGraphics(img.width, img.height);
      pg.fill(255); 
      pg.noStroke();
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

  // 1. SETUP BOUNDARIES
  let safeW = width * FIT_MARGIN_W;
  let boundaryX = safeW / 2;
  let boundaryY = height / 2; 
  
  // FIX: Increased dead zone calculation robustness
  let deadLimit = (height * 0.15 / 2) + 30; 
  
  let availableVerticalStrip = boundaryY - deadLimit;
  let baseReferenceSize;
  
  if (safeW > availableVerticalStrip * 1.5) {
      baseReferenceSize = availableVerticalStrip * 3.5; 
  } else {
      baseReferenceSize = safeW * 1.5;
  }
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

      let baseSize = isHero ? 
          baseReferenceSize * random(2.0, 3.0) : 
          baseReferenceSize * random(0.5, 1.2);
      
      baseSize *= random(0.85, 1.15);

      let w, h;
      if (ratio >= 1) { w = baseSize; h = w / ratio; }
      else { h = baseSize; w = h * ratio; }

      if (h > maxPhysicalH) { h = maxPhysicalH; w = h * ratio; }
      if (w > safeW - 20) { w = safeW - 20; h = w / ratio; }

      candidates.push({ 
          img, w, h, ratio, 
          area: w * h,
          isHero,
          id: i
      });
  }

  candidates.sort((a, b) => b.area - a.area);

  let placedNodes = [];
  let topCount = 0;
  let bottomCount = 0;

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
              let myL = rx - w/2; 
              let myR = rx + w/2;
              let myT = ry - h/2;
              let myB = ry + h/2;

              for (let other of placedNodes) {
                  let otherL = other.x - other.w/2;
                  let otherR = other.x + other.w/2;
                  let otherT = other.y - other.h/2;
                  let otherB = other.y + other.h/2;

                  if (Math.abs(other.x - rx) < 15) { isInvalid = true; break; }
                  if (Math.abs(other.y - ry) < 15) { isInvalid = true; break; }

                  let overlapW = Math.min(myR, otherR) - Math.max(myL, otherL);
                  let overlapH = Math.min(myB, otherB) - Math.max(myT, otherT);

                  if (overlapW > 0 && overlapH > 0) {
                      let area1 = w * h;
                      let area2 = other.w * other.h;
                      let sizeRatio = Math.min(area1, area2) / Math.max(area1, area2);
                      let isSimilarSize = (sizeRatio > 0.4); 

                      if (isSimilarSize) {
                          isInvalid = true; 
                          break;
                      } else {
                          let overlapArea = overlapW * overlapH;
                          let minArea = Math.min(area1, area2);
                          if (overlapArea / minArea > 0.60) {
                              isInvalid = true;
                              break;
                          }
                      }
                  }
              }

              if (!isInvalid) {
                  placedNodes.push({
                      img: cand.img,
                      w: w, h: h,
                      x: rx, y: ry,
                      targetPos: createVector(rx, ry, 0),
                      startTime: frameCount,
                      isPlaceholder: isPlaceholderBatch
                  });
                  if (ry < 0) topCount++; else bottomCount++;
                  placed = true;
                  break; 
              }
          }

          if (!placed) {
              currentScale -= 0.05; 
          }
      }
  }

  nodes = placedNodes;

  let zSpacing = 5;
  let totalDepth = nodes.length * zSpacing;
  let startZ = -(totalDepth / 2);

  for(let i = 0; i < nodes.length; i++) {
      nodes[i].targetPos.z = startZ + (i * zSpacing);
  }
}

function renderScene(pg, txtLayer, w, h, s) {
  pg.background('#E9EBE6'); 
  pg.perspective(PI / 3.0, w / h, 0.1, 15000);
  
  pg.push();
  pg.camera(0, 0, camDist, 0, 0, 0, 0, 1, 0); 
  pg.rotateX(camRotX);
  pg.rotateY(camRotY);

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
  renderScene(this, textBuffer, width, height, renderScale);
  if (recorder && isRecording) {
      recorder.capture(document.querySelector('canvas'));
  }
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
      for (let i = 0; i < word.length; i++) {
          wid += buf.textWidth(word.charAt(i)) + tracking;
      }
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
  // Ensure font is loaded before using
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

      if (isStatic || framesPassed > wordTrigger) {
          drawTightWord(words1[i], currentX1, startY1, track1);
      }
      currentX1 += w + spaceW1; 
  }

  let words2 = ["curated", "by", `@${inputLine2.value()}`];
  buf.textSize(size2);
  let startY2 = buf.height/2 + (leading/2);
  
  let totalW2 = 0;
  let spaceW2 = 0; 
  
  for(let i = 0; i < words2.length; i++) {
      let isHeroFont = (i < 2); 
      if (fontHeadline && fontSubheadMedium) {
          if (isHeroFont) buf.textFont(fontHeadline);
          else buf.textFont(fontSubheadMedium);
      }
      
      totalW2 += getTightWidth(words2[i], track2);
      
      if (i < words2.length - 1) {
          totalW2 += buf.textWidth(" ");
      }
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

      if (isStatic || framesPassed > wordTrigger) {
          drawTightWord(words2[i], currentX2, startY2, track2);
      }
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
  if (choice === 'print') { tw = 2400; th = 3000; }
  if (choice === 'window') { tw = windowWidth; th = windowHeight; }
  
  let exportScale = tw / width;
  
  let pg = createGraphics(tw, th, WEBGL);
  let pgText = createGraphics(tw, th);
  pg.pixelDensity(1); 
  pgText.pixelDensity(1);
  
  renderScene(pg, pgText, tw, th, exportScale);
  
  let dataUrl = pg.canvas.toDataURL("image/png");
  let a = document.createElement('a');
  a.download = 'editorial_burst.png';
  a.href = dataUrl;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  
  pg.remove();
  pgText.remove();
}

function startVideoExport() {
    if (nodes.length === 0) { alert("⚠️ Please upload images first!"); return; }
    if (typeof CCapture === 'undefined') { alert("Video engine loading..."); return; }
    
    let choice = exportSelect.value();
    let tw = (choice === 'portrait' || choice === 'square') ? 1080 : 1920;
    let th = (choice === 'portrait') ? 1920 : (choice === 'landscape' || choice === 'square') ? 1080 : 3000;
    if (choice === 'window') { tw = windowWidth; th = windowHeight; }

    renderScale = tw / width; 

    resizeCanvas(tw, th);
    textBuffer.resizeCanvas(tw, th);
    
    let cnv = document.querySelector('canvas');
    cnv.style.width = '100%'; 
    cnv.style.height = '100%';
    cnv.style.maxWidth = '100vw'; 
    cnv.style.maxHeight = '100vh'; 
    cnv.style.objectFit = 'contain';

    resetCamera(); 

    triggerBurst(false); 

    isRecording = true;
    try {
        recorder = new CCapture({ format: 'webm', framerate: 30 });
        recorder.start();
        recordBtn.html("Recording..."); 
        recordBtn.style('color', 'red');
        
        let words1 = inputLine1.value().trim().split(/\s+/);
        let words2 = ["curated", "by", `@${inputLine2.value()}`];
        let introDuration = INITIAL_BLANK_FRAMES + (words1.length * WORD_REVEAL_INTERVAL) + LINE_BREAK_PAUSE + (words2.length * WORD_REVEAL_INTERVAL) + PRE_BURST_PAUSE;
        let lastItemArrival = ((nodes.length - 1) * STAGGER_FRAMES) + MOVE_DURATION;
        let startImplodeFrame = lastItemArrival + EXPANSION_BUFFER;
        let endFrame = startImplodeFrame + IMPLODE_DURATION;
        let totalFrames = introDuration + endFrame + 15; 
        let ms = (totalFrames / 30) * 1000;

        setTimeout(() => { if(isRecording) stopVideoExport(); }, ms + 500); 
    } catch(e) { 
        isRecording = false; 
        alert("Recording failed."); 
        stopVideoExport(); 
    }
}

function stopVideoExport() {
    if(recorder) {
        recorder.stop(); 
        recorder.save(); 
        isRecording = false;
        recordBtn.html("Save Video"); 
        recordBtn.style('color', '#000'); 
        
        let cnv = document.querySelector('canvas');
        cnv.style.width = '';
        cnv.style.height = '';
        cnv.style.maxWidth = '';
        cnv.style.maxHeight = '';
        
        renderScale = 1;
        applyLayout();
    }
}

function handleVideoToggle() { 
    if (isRecording) stopVideoExport(); 
    else startVideoExport(); 
}

// FIX: Debounced Resize to prevent layout thrashing
function windowResized() {
  if (isRecording) return;
  
  if (resizeTimer) clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    applyLayout();
    refreshBurstNodes(false); 
    repositionUI();
  }, 200);
}

function repositionUI() {
  const margin = 20;
  // Ensure UI stays on screen even if height is small
  let uiY = height - 100;
  let uiY2 = height - 60;
  
  // Safety check
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

function handleCameraDrag() {
    camRotY += (mouseX - pmouseX) * 0.005; 
    camRotX += (mouseY - pmouseY) * 0.005;
}
function mousePressed() { if (mouseY < height - 120) isDragging = true; }
function mouseReleased() { isDragging = false; }
// Ensure absolute positioning for UI elements
function styleUI(elt, x, y, w) { 
    elt.position(x, y); 
    elt.style('width', w + 'px'); 
    elt.style('position', 'absolute');
    elt.style('z-index', '10'); // Always on top
}

function loadScript(url, callback){
    var script = document.createElement("script");
    script.type = "text/javascript";
    script.onload = function(){ callback(); };
    script.src = url;
    document.getElementsByTagName("head")[0].appendChild(script);
}