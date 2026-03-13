const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const startButton = document.getElementById("start-btn");
const questionUi = document.getElementById("question-ui");
const questionUiPrompt = document.getElementById("question-ui-prompt");
const questionUiText = document.getElementById("question-ui-text");
const questionUiVoice = document.getElementById("question-ui-voice");
const questionUiStatus = document.getElementById("question-ui-status");
const questionInput = document.getElementById("question-input");
const questionSubmit = document.getElementById("question-submit");
const micRetryButton = document.getElementById("mic-retry");
const touchButtons = Array.from(document.querySelectorAll(".touch-btn"));

const WIDTH = canvas.width;
const HEIGHT = canvas.height;
const GROUND_Y = 438;
const SEA_Y = 320;
const TOTAL_SPARKS = 20;
const OCEAN_ENTRY_X = 628;
const QUESTION_BANK = [
  { mode: "text", prompt: "What is your name?" },
  { mode: "text", prompt: "What is special about you?" },
  { mode: "text", prompt: "How can you experience Shabbat better?" },
  { mode: "text", prompt: "What is a good deed you want to do?" },
  { mode: "text", prompt: "What is this week's Parsha?" },
  { mode: "text", prompt: "Tell me, do you believe in yourself?" },
  { mode: "text", prompt: "Do you believe you can change the world?" },
  { mode: "voice_phrase", prompt: 'Say "Lecha Dodi".', expectedPhrase: "lecha dodi" },
  { mode: "sing_note", prompt: "Sing a note." },
  { mode: "voice_phrase", prompt: 'Say "Good Shabbos".', expectedPhrase: "good shabbos" },
  { mode: "voice_phrase", prompt: 'Say "I love Hashem".', expectedPhrase: "i love hashem" },
  { mode: "voice_phrase", prompt: 'Say "I love my fellow like myself".', expectedPhrase: "i love my fellow like myself" },
];

const keys = new Set();
let manualStepMode = false;
let accumulator = 0;
let lastFrameTime = 0;
let activeSpeechRecognition = null;
let activeAudioStream = null;
let activeAudioContext = null;
let activeAnalyser = null;
let activePitchData = null;
let activePitchRaf = 0;

const art = {
  figure: loadImage("assets/figure.png"),
  sparkImages: [
    loadImage("assets/sparks/spark-01.png"),
    loadImage("assets/sparks/spark-02.png"),
    loadImage("assets/sparks/spark-03.png"),
    loadImage("assets/sparks/spark-04.png"),
    loadImage("assets/sparks/spark-05.png"),
    loadImage("assets/sparks/spark-06.png"),
    loadImage("assets/sparks/spark-07.png"),
    loadImage("assets/sparks/spark-08.png"),
  ],
};

function loadImage(src) {
  const image = new Image();
  image.src = src;
  return image;
}

function createSparkField() {
  return Array.from({ length: TOTAL_SPARKS }, (_, index) => ({
    id: index,
    x: 150 + index * 38,
    y: 210 + ((index % 5) * 22),
    phase: index * 0.55,
    scale: 0.055 + (index % 3) * 0.008,
    imageIndex: index % art.sparkImages.length,
    collected: false,
  }));
}

function makeInitialState() {
  return {
    mode: "title",
    paused: false,
    fullscreen: false,
    time: 0,
    score: 0,
    message: "Gather twenty sparks to welcome Shabbat.",
    player: {
      x: 86,
      y: GROUND_Y,
      vx: 0,
      facing: 1,
      speed: 230,
      width: 168,
      height: 250,
      immersion: 0,
    },
    sparks: createSparkField(),
    shabbat: {
      active: false,
      transition: 0,
      glowPulse: 0,
    },
    question: null,
  };
}

let state = makeInitialState();

function getActiveSpark() {
  if (state.question) {
    return state.sparks.find((spark) => spark.id === state.question.sparkId) || null;
  }
  return state.sparks.find((spark) => !spark.collected) || null;
}

function controlCodeFor(name) {
  const map = {
    left: "ArrowLeft",
    right: "ArrowRight",
    up: "ArrowUp",
    down: "ArrowDown",
  };
  return map[name] || null;
}

function pressVirtualControl(name) {
  if (name === "enter") {
    if (state.question && state.question.mode === "text") {
      state.question.response = questionInput.value;
      resolveSparkQuestion();
    } else if (!state.question && state.mode === "title") {
      startGame();
    }
    return;
  }

  const code = controlCodeFor(name);
  if (code) {
    keys.add(code);
  }
}

function releaseVirtualControl(name) {
  const code = controlCodeFor(name);
  if (code) {
    keys.delete(code);
  }
}

function syncQuestionUi() {
  if (!state.question) {
    questionUi.classList.add("hidden");
    questionUiText.classList.add("hidden");
    questionUiVoice.classList.add("hidden");
    return;
  }

  questionUi.classList.remove("hidden");
  questionUiPrompt.textContent = state.question.prompt;

  if (state.question.mode === "text") {
    questionUiText.classList.remove("hidden");
    questionUiVoice.classList.add("hidden");
    if (questionInput.value !== state.question.response) {
      questionInput.value = state.question.response;
    }
  } else {
    questionUiText.classList.add("hidden");
    questionUiVoice.classList.remove("hidden");
    const status = state.question.mode === "sing_note"
      ? `Mic: ${state.question.micState}. Pitch: ${state.question.pitchHz || 0} Hz.`
      : `Mic: ${state.question.micState}. Heard: ${state.question.transcript || "..."}.`;
    questionUiStatus.textContent = status;
  }
}

function getControlButtons() {
  return [
    { id: "pause", label: state.paused ? "Play" : "Pause", x: WIDTH - 270, y: 54, w: 72, h: 30 },
    { id: "restart", label: "Restart", x: WIDTH - 186, y: 54, w: 82, h: 30 },
    { id: "fullscreen", label: "Full", x: WIDTH - 92, y: 54, w: 58, h: 30 },
  ];
}

function startGame() {
  if (state.mode !== "title") {
    return;
  }
  state.mode = "playing";
  state.message = "Walk the shoreline and gather every spark.";
  startButton.classList.add("hidden");
  render();
}

function restartGame() {
  stopQuestionInput();
  state = makeInitialState();
  state.mode = "playing";
  state.message = "The walk begins again.";
  startButton.classList.add("hidden");
  render();
}

function togglePause() {
  if (state.mode === "title") {
    return;
  }
  state.paused = !state.paused;
  state.message = state.paused ? "Pause for breath." : state.shabbat.active ? "Shabbat glows around the shore." : "Walk on.";
}

async function toggleFullscreen() {
  const shell = document.querySelector(".canvas-shell");
  if (!document.fullscreenElement) {
    if (shell.requestFullscreen) {
      await shell.requestFullscreen();
    }
  } else if (document.exitFullscreen) {
    await document.exitFullscreen();
  }
}

function activateShabbat() {
  state.shabbat.active = true;
  state.mode = "shabbat";
  state.message = "Shabbat arrives. Candles and blue light fill the shore.";
}

function startSparkQuestion(spark) {
  stopQuestionInput();
  const template = QUESTION_BANK[spark.id % QUESTION_BANK.length];
  state.question = {
    sparkId: spark.id,
    prompt: template.prompt,
    mode: template.mode,
    expectedPhrase: template.expectedPhrase || null,
    response: "",
    transcript: "",
    micState: template.mode === "text" ? "typing" : "starting",
    pitchHz: 0,
    singFrames: 0,
  };
  state.message = "Answer the question to gather the spark.";
  if (template.mode === "voice_phrase") {
    startVoicePhraseCapture();
  } else if (template.mode === "sing_note") {
    startSingCapture();
  }
}

function resolveSparkQuestion() {
  const question = state.question;
  if (!question) {
    return;
  }

  const spark = state.sparks.find((item) => item.id === question.sparkId);
  if (!spark) {
    stopQuestionInput();
    state.question = null;
    return;
  }

  const isResolved =
    (question.mode === "text" && question.response.trim()) ||
    ((question.mode === "voice_phrase" || question.mode === "sing_note") && question.micState === "success");

  if (isResolved) {
    spark.collected = true;
    state.score += 1;
    state.message = `Spark gathered ${state.score}/${TOTAL_SPARKS}.`;
    if (state.score >= TOTAL_SPARKS) {
      activateShabbat();
    }
    stopQuestionInput();
    state.question = null;
  } else {
    state.message = question.mode === "text" ? "Give the spark an answer first." : "The spark is still listening.";
  }
}

function normalizeSpeech(value) {
  return value.toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
}

function stopQuestionInput() {
  if (activeSpeechRecognition) {
    try {
      activeSpeechRecognition.onresult = null;
      activeSpeechRecognition.onerror = null;
      activeSpeechRecognition.onend = null;
      activeSpeechRecognition.stop();
    } catch {}
    activeSpeechRecognition = null;
  }

  if (activePitchRaf) {
    cancelAnimationFrame(activePitchRaf);
    activePitchRaf = 0;
  }

  if (activeAudioStream) {
    activeAudioStream.getTracks().forEach((track) => track.stop());
    activeAudioStream = null;
  }

  if (activeAudioContext) {
    activeAudioContext.close().catch(() => {});
    activeAudioContext = null;
  }

  activeAnalyser = null;
  activePitchData = null;
}

function markVoiceQuestionSuccess(message) {
  if (!state.question) {
    return;
  }
  state.question.micState = "success";
  state.message = message;
}

function startVoicePhraseCapture() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!state.question) {
    return;
  }
  if (!SpeechRecognition) {
    state.question.micState = "unsupported";
    state.message = "Speech recognition is not available in this browser.";
    return;
  }

  const recognition = new SpeechRecognition();
  activeSpeechRecognition = recognition;
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = "en-US";

  recognition.onresult = (event) => {
    if (!state.question) {
      return;
    }
    const transcript = Array.from(event.results)
      .map((result) => result[0]?.transcript || "")
      .join(" ")
      .trim();
    state.question.transcript = transcript;
    state.question.micState = "listening";
    if (normalizeSpeech(transcript).includes(normalizeSpeech(state.question.expectedPhrase || ""))) {
      markVoiceQuestionSuccess("The spark heard your words.");
      resolveSparkQuestion();
    }
  };

  recognition.onerror = () => {
    if (state.question) {
      state.question.micState = "error";
      state.message = "The spark could not hear you. Press V to try again.";
    }
  };

  recognition.onend = () => {
    if (!state.question || state.question.micState === "success") {
      return;
    }
    if (state.question.mode === "voice_phrase") {
      state.question.micState = "waiting";
    }
  };

  recognition.start();
}

function detectPitch(buffer, sampleRate) {
  let bestOffset = -1;
  let bestCorrelation = 0;
  let rms = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    const value = buffer[i];
    rms += value * value;
  }
  rms = Math.sqrt(rms / buffer.length);
  if (rms < 0.015) {
    return 0;
  }

  const maxSamples = Math.floor(buffer.length / 2);
  for (let offset = 8; offset < maxSamples; offset += 1) {
    let correlation = 0;
    for (let i = 0; i < maxSamples; i += 1) {
      correlation += 1 - Math.abs(buffer[i] - buffer[i + offset]);
    }
    correlation /= maxSamples;
    if (correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestOffset = offset;
    }
  }

  if (bestCorrelation > 0.9 && bestOffset > 0) {
    return sampleRate / bestOffset;
  }
  return 0;
}

function monitorSingPitch() {
  if (!state.question || state.question.mode !== "sing_note" || !activeAnalyser || !activePitchData) {
    return;
  }
  activeAnalyser.getFloatTimeDomainData(activePitchData);
  const hz = detectPitch(activePitchData, activeAudioContext.sampleRate);
  state.question.pitchHz = Math.round(hz);
  if (hz >= 170 && hz <= 950) {
    state.question.singFrames += 1;
  } else {
    state.question.singFrames = 0;
  }
  state.question.micState = "listening";
  if (state.question.singFrames >= 8) {
    markVoiceQuestionSuccess("The spark caught your sung note.");
    resolveSparkQuestion();
    return;
  }
  activePitchRaf = requestAnimationFrame(monitorSingPitch);
}

async function startSingCapture() {
  if (!state.question) {
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      state.question.micState = "unsupported";
      state.message = "Audio pitch detection is not available in this browser.";
      return;
    }
    activeAudioStream = stream;
    activeAudioContext = new AudioContextClass();
    const source = activeAudioContext.createMediaStreamSource(stream);
    activeAnalyser = activeAudioContext.createAnalyser();
    activeAnalyser.fftSize = 2048;
    activePitchData = new Float32Array(activeAnalyser.fftSize);
    source.connect(activeAnalyser);
    state.question.micState = "listening";
    monitorSingPitch();
  } catch {
    if (state.question) {
      state.question.micState = "error";
      state.message = "The spark could not access the microphone. Press V to try again.";
    }
  }
}

function update(dt) {
  if (state.mode === "title" || state.paused || state.question) {
    return;
  }

  state.time += dt;
  const movingLeft = keys.has("ArrowLeft") || keys.has("KeyA");
  const movingRight = keys.has("ArrowRight") || keys.has("KeyD");
  const movingUp = keys.has("ArrowUp") || keys.has("KeyW");
  const movingDown = keys.has("ArrowDown") || keys.has("KeyS");
  const direction = (movingRight ? 1 : 0) - (movingLeft ? 1 : 0);

  state.player.vx = direction * state.player.speed;
  if (direction !== 0) {
    state.player.facing = direction;
  }

  state.player.x += state.player.vx * dt;
  state.player.x = clamp(state.player.x, 64, 894);
  const nearOcean = state.player.x >= OCEAN_ENTRY_X;

  if (nearOcean) {
    const immersionDelta = (movingDown ? 1 : 0) - (movingUp ? 1 : 0);
    state.player.immersion = clamp(state.player.immersion + immersionDelta * dt * 0.9, 0, 1);
    if (immersionDelta > 0 && state.player.immersion > 0.18) {
      state.message = "She enters the ocean like a mikveh.";
    } else if (immersionDelta < 0 && state.player.immersion < 0.18) {
      state.message = "She rises from the water.";
    }
  } else {
    state.player.immersion = clamp(state.player.immersion - dt * 1.4, 0, 1);
  }

  state.player.y = GROUND_Y + state.player.immersion * 72;

  const activeSpark = getActiveSpark();
  if (activeSpark && !activeSpark.collected && Math.abs(state.player.x - activeSpark.x) < 22) {
    startSparkQuestion(activeSpark);
  }

  if (state.shabbat.active) {
    state.shabbat.transition = clamp(state.shabbat.transition + dt * 0.28, 0, 1);
    state.shabbat.glowPulse += dt * 1.4;
  }
}

function loop(timestamp) {
  if (!lastFrameTime) {
    lastFrameTime = timestamp;
  }
  const delta = Math.min(0.05, (timestamp - lastFrameTime) / 1000);
  lastFrameTime = timestamp;

  if (!manualStepMode) {
    accumulator += delta;
    while (accumulator >= 1 / 60) {
      update(1 / 60);
      accumulator -= 1 / 60;
    }
  }

  render();
  window.requestAnimationFrame(loop);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpColor(a, b, t) {
  return {
    r: Math.round(lerp(a.r, b.r, t)),
    g: Math.round(lerp(a.g, b.g, t)),
    b: Math.round(lerp(a.b, b.b, t)),
  };
}

function rgb(color, alpha = 1) {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
}

function drawBackground() {
  const transition = state.shabbat.transition;
  const skyTop = lerpColor({ r: 249, g: 231, b: 200 }, { r: 19, g: 33, b: 84 }, transition);
  const skyBottom = lerpColor({ r: 177, g: 201, b: 219 }, { r: 31, g: 58, b: 128 }, transition);
  const seaTop = lerpColor({ r: 109, g: 142, b: 167 }, { r: 27, g: 52, b: 110 }, transition);
  const seaBottom = lerpColor({ r: 81, g: 111, b: 133 }, { r: 14, g: 31, b: 70 }, transition);

  const sky = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  sky.addColorStop(0, rgb(skyTop));
  sky.addColorStop(0.58, rgb(skyBottom));
  sky.addColorStop(1, rgb({ r: 60, g: 80, b: 92 }));
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.fillStyle = rgb({ r: 255, g: 241, b: 204 }, 0.42 - transition * 0.22);
  ctx.beginPath();
  ctx.ellipse(790, 118, 92, 56, 0, 0, Math.PI * 2);
  ctx.fill();

  const sea = ctx.createLinearGradient(0, SEA_Y, 0, HEIGHT);
  sea.addColorStop(0, rgb(seaTop, 0.94));
  sea.addColorStop(1, rgb(seaBottom, 0.98));
  ctx.fillStyle = sea;
  ctx.fillRect(0, SEA_Y, WIDTH, HEIGHT - SEA_Y);

  for (let i = 0; i < 6; i += 1) {
    const y = SEA_Y + 16 + i * 23;
    ctx.strokeStyle = `rgba(220, 232, 245, ${0.12 + transition * 0.08 + i * 0.02})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = 0; x <= WIDTH; x += 24) {
      const wave = Math.sin(x * 0.014 + state.time * (1.8 + transition) + i) * (7 + i);
      if (x === 0) {
        ctx.moveTo(x, y + wave);
      } else {
        ctx.lineTo(x, y + wave);
      }
    }
    ctx.stroke();
  }

  const sand = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  sand.addColorStop(0, rgb(lerpColor({ r: 229, g: 201, b: 155 }, { r: 133, g: 118, b: 103 }, transition)));
  sand.addColorStop(1, rgb(lerpColor({ r: 198, g: 164, b: 116 }, { r: 94, g: 80, b: 74 }, transition)));
  ctx.fillStyle = sand;
  ctx.beginPath();
  ctx.moveTo(0, GROUND_Y - 32);
  ctx.quadraticCurveTo(220, GROUND_Y - 72, 480, GROUND_Y - 26);
  ctx.quadraticCurveTo(700, GROUND_Y + 14, WIDTH, GROUND_Y - 40);
  ctx.lineTo(WIDTH, HEIGHT);
  ctx.lineTo(0, HEIGHT);
  ctx.closePath();
  ctx.fill();

  if (transition > 0) {
    const glow = 0.16 + Math.sin(state.shabbat.glowPulse) * 0.04;
    const radial = ctx.createRadialGradient(WIDTH * 0.5, HEIGHT * 0.44, 30, WIDTH * 0.5, HEIGHT * 0.44, 420);
    radial.addColorStop(0, `rgba(255, 242, 196, ${0.22 + glow})`);
    radial.addColorStop(1, "rgba(255, 242, 196, 0)");
    ctx.fillStyle = radial;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }
}

function drawCandles() {
  if (!state.shabbat.active) {
    return;
  }

  const t = state.shabbat.transition;
  const y = 288 - (1 - t) * 18;
  const baseAlpha = 0.2 + t * 0.8;

  ctx.fillStyle = `rgba(241, 233, 220, ${baseAlpha})`;
  ctx.fillRect(126, y, 18, 84);
  ctx.fillRect(156, y + 6, 18, 78);

  ctx.fillStyle = `rgba(255, 228, 138, ${baseAlpha})`;
  ctx.beginPath();
  ctx.ellipse(135, y - 10, 12, 22, 0, 0, Math.PI * 2);
  ctx.ellipse(165, y - 10, 12, 22, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = `rgba(255, 246, 215, ${baseAlpha})`;
  ctx.beginPath();
  ctx.ellipse(135, y - 13, 5, 9, 0, 0, Math.PI * 2);
  ctx.ellipse(165, y - 13, 5, 9, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = `rgba(255, 233, 172, ${0.16 + t * 0.2})`;
  ctx.beginPath();
  ctx.ellipse(146, y + 20, 104, 120, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawSpark(spark) {
  const bobY = spark.y + Math.sin(state.time * 1.8 + spark.phase) * 12;
  const pulse = 0.92 + Math.sin(state.time * 2.4 + spark.phase) * 0.06;
  const sparkImage = art.sparkImages[spark.imageIndex];

  ctx.fillStyle = `rgba(255, 241, 186, ${0.14 + state.shabbat.transition * 0.08})`;
  ctx.beginPath();
  ctx.ellipse(spark.x, bobY, 54, 54, 0, 0, Math.PI * 2);
  ctx.fill();

  if (sparkImage && sparkImage.complete && sparkImage.naturalWidth > 0) {
    const width = sparkImage.naturalWidth * spark.scale * pulse;
    const height = sparkImage.naturalHeight * spark.scale * pulse;
    ctx.drawImage(sparkImage, spark.x - width / 2, bobY - height / 2, width, height);
  } else {
    ctx.fillStyle = "rgba(255, 247, 226, 0.96)";
    ctx.beginPath();
    ctx.arc(spark.x, bobY, 13, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawSparks() {
  const activeSpark = getActiveSpark();
  if (activeSpark && !activeSpark.collected) {
    drawSpark(activeSpark);
  }
}

function drawFigure() {
  const haloAlpha = state.shabbat.active ? 0.26 + state.shabbat.transition * 0.16 : 0.18;
  ctx.fillStyle = `rgba(255, 241, 210, ${haloAlpha})`;
  ctx.beginPath();
  ctx.ellipse(state.player.x, state.player.y - 66, 116, 172, 0, 0, Math.PI * 2);
  ctx.fill();

  if (art.figure.complete && art.figure.naturalWidth > 0) {
    const drawWidth = state.player.width;
    const drawHeight = (art.figure.naturalHeight / art.figure.naturalWidth) * drawWidth;
    ctx.save();
    ctx.translate(state.player.x, state.player.y - 68);
    if (state.player.facing < 0) {
      ctx.scale(-1, 1);
    }
    ctx.drawImage(art.figure, -drawWidth / 2, -drawHeight / 2 + 10, drawWidth, drawHeight);
    ctx.restore();
  } else {
    ctx.fillStyle = "#c9d2de";
    ctx.fillRect(state.player.x - 18, GROUND_Y - 104, 36, 104);
  }

  ctx.fillStyle = "rgba(75, 63, 51, 0.14)";
  ctx.beginPath();
  ctx.ellipse(state.player.x, state.player.y + 12, 96, 24, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawOceanForeground() {
  if (state.player.x < OCEAN_ENTRY_X - 20 && state.player.immersion <= 0) {
    return;
  }

  const immersion = state.player.immersion;
  const overlayAlpha = 0.12 + immersion * 0.28 + state.shabbat.transition * 0.08;
  ctx.fillStyle = `rgba(118, 164, 207, ${overlayAlpha})`;
  ctx.beginPath();
  ctx.moveTo(0, SEA_Y + 18);
  for (let x = 0; x <= WIDTH; x += 20) {
    const wave = Math.sin(x * 0.018 + state.time * 2.2) * 8;
    ctx.lineTo(x, SEA_Y + 18 + wave);
  }
  ctx.lineTo(WIDTH, HEIGHT);
  ctx.lineTo(0, HEIGHT);
  ctx.closePath();
  ctx.fill();

  if (immersion > 0.05) {
    ctx.strokeStyle = `rgba(230, 243, 255, ${0.24 + immersion * 0.22})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(state.player.x, SEA_Y + 26 + immersion * 30, 54 + immersion * 18, 12 + immersion * 5, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(state.player.x, SEA_Y + 42 + immersion * 36, 78 + immersion * 22, 18 + immersion * 7, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawHud() {
  ctx.fillStyle = "rgba(249, 246, 238, 0.84)";
  ctx.fillRect(20, 18, 370, 122);
  ctx.fillStyle = "#4d5964";
  ctx.font = "28px Georgia, serif";
  ctx.fillText("Lecha Dodi", 36, 54);
  ctx.font = "18px Georgia, serif";
  ctx.fillText(`Sparks: ${state.score}/${TOTAL_SPARKS}`, 36, 84);
  ctx.fillText(`Scene: ${state.shabbat.active ? "Shabbat" : "Dusk shore"}`, 36, 110);
  if (state.question) {
    ctx.fillText("Spark question active", 36, 136);
  }

  ctx.textAlign = "right";
  ctx.fillText(state.message, WIDTH - 24, 36);
  ctx.textAlign = "left";

  for (const button of getControlButtons()) {
    ctx.fillStyle = "rgba(247, 240, 227, 0.88)";
    ctx.fillRect(button.x, button.y, button.w, button.h);
    ctx.strokeStyle = "rgba(112, 91, 64, 0.28)";
    ctx.lineWidth = 1;
    ctx.strokeRect(button.x, button.y, button.w, button.h);
    ctx.fillStyle = "#5e5142";
    ctx.font = "16px Georgia, serif";
    ctx.textAlign = "center";
    ctx.fillText(button.label, button.x + button.w / 2, button.y + 20);
    ctx.textAlign = "left";
  }
}

function drawOverlayPanel(title, lines) {
  ctx.fillStyle = "rgba(33, 43, 52, 0.54)";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = "rgba(251, 246, 236, 0.95)";
  ctx.fillRect(142, 128, 676, 286);
  ctx.fillStyle = "#4d3c2b";
  ctx.font = "42px Georgia, serif";
  ctx.fillText(title, 206, 206);
  ctx.fillStyle = "#55616c";
  ctx.font = "24px Georgia, serif";
  lines.forEach((line, index) => {
    ctx.fillText(line, 206, 258 + index * 40);
  });
}

function drawQuestionOverlay() {
  if (!state.question) {
    return;
  }

  ctx.fillStyle = "rgba(24, 32, 44, 0.62)";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = "rgba(251, 246, 236, 0.96)";
  ctx.fillRect(122, 150, 716, 238);
  ctx.fillStyle = "#4d3c2b";
  ctx.font = "36px Georgia, serif";
  ctx.fillText("Answer for the spark", 164, 206);
  ctx.fillStyle = "#55616c";
  ctx.font = "24px Georgia, serif";
  ctx.fillText(state.question.prompt, 164, 254);

  if (state.question.mode === "text") {
    ctx.fillStyle = "rgba(241, 237, 230, 0.95)";
    ctx.fillRect(164, 292, 632, 64);
    ctx.strokeStyle = "#8d6a3d";
    ctx.lineWidth = 2;
    ctx.strokeRect(164, 292, 632, 64);
    ctx.fillStyle = state.question.response ? "#4d5964" : "rgba(77, 89, 100, 0.58)";
    ctx.font = "22px Georgia, serif";
    const responseText = state.question.response || "Type your answer here";
    ctx.fillText(responseText.slice(-46), 182, 331);
    ctx.font = "18px Georgia, serif";
    ctx.fillText("Type your answer, then press Enter. Backspace deletes.", 164, 380);
  } else {
    ctx.fillStyle = "rgba(241, 237, 230, 0.95)";
    ctx.fillRect(164, 292, 632, 64);
    ctx.strokeStyle = "#8d6a3d";
    ctx.lineWidth = 2;
    ctx.strokeRect(164, 292, 632, 64);
    ctx.fillStyle = "#4d5964";
    ctx.font = "22px Georgia, serif";
    const statusLine = state.question.mode === "sing_note"
      ? `Mic: ${state.question.micState} | pitch: ${state.question.pitchHz || 0} Hz`
      : `Mic: ${state.question.micState} | heard: ${state.question.transcript || "..."}`;
    ctx.fillText(statusLine.slice(-58), 182, 331);
    ctx.font = "18px Georgia, serif";
    const hint = state.question.mode === "sing_note"
      ? "Sing one steady note into the microphone. Press V to retry the mic."
      : `Say: "${state.question.expectedPhrase}". Press V to retry the mic.`;
    ctx.fillText(hint, 164, 380);
  }
}

function render() {
  drawBackground();
  drawCandles();
  drawSparks();
  drawFigure();
  drawOceanForeground();
  drawHud();

  if (state.mode === "title") {
    drawOverlayPanel("Gather the twenty sparks", [
      "Walk right and left along the shore to reach the moon sparks.",
      "Some sparks need typed reflections, and later sparks need your voice.",
      "When all twenty are collected, the world shifts into Shabbat.",
      "On the right edge, press Down or S to enter the ocean like a mikveh.",
    ]);
  } else if (state.paused) {
    drawOverlayPanel("Paused", [
      "Press P or B to continue.",
      "Press R to begin again.",
      "Press F for fullscreen and Up or W to rise from the water.",
    ]);
  } else if (state.shabbat.active) {
    ctx.fillStyle = `rgba(255, 242, 196, ${0.12 + state.shabbat.transition * 0.08})`;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }

  drawQuestionOverlay();
  syncQuestionUi();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function handleKeyDown(event) {
  keys.add(event.code);

  if (state.question) {
    if (event.code === "Enter" && state.question.mode === "text") {
      event.preventDefault();
      resolveSparkQuestion();
      return;
    }
    if (event.code === "KeyV" && state.question.mode !== "text") {
      event.preventDefault();
      stopQuestionInput();
      if (state.question.mode === "voice_phrase") {
        state.question.micState = "starting";
        startVoicePhraseCapture();
      } else {
        state.question.micState = "starting";
        startSingCapture();
      }
      return;
    }
    if (navigator.webdriver && event.code === "KeyB" && state.question.mode !== "text") {
      event.preventDefault();
      state.question.micState = "success";
      resolveSparkQuestion();
      return;
    }
    if (state.question.mode !== "text") {
      return;
    }
    if (event.code === "Backspace") {
      event.preventDefault();
      state.question.response = state.question.response.slice(0, -1);
      return;
    }
    if (event.code === "Space") {
      event.preventDefault();
      state.question.response += " ";
      return;
    }
    if (event.code === "KeyA") {
      state.question.response += "a";
      return;
    }
    if (event.code === "KeyB") {
      state.question.response += "b";
      return;
    }
    if (event.key && event.key.length === 1 && !event.metaKey && !event.ctrlKey) {
      state.question.response += event.key;
      return;
    }
  }

  if (event.code === "Space" || event.code === "Enter") {
    event.preventDefault();
    if (state.mode === "title") {
      startGame();
    }
  }

  if (event.code === "KeyP") {
    togglePause();
  }

  if (event.code === "KeyR") {
    restartGame();
  }

  if (event.code === "KeyF") {
    toggleFullscreen().catch(() => {});
  }

  if (event.code === "KeyB") {
    if (state.mode === "title" || state.shabbat.active) {
      toggleFullscreen().catch(() => {});
    } else {
      togglePause();
    }
  }
}

function handleKeyUp(event) {
  keys.delete(event.code);
}

function handleFullscreenChange() {
  state.fullscreen = Boolean(document.fullscreenElement);
}

function getCanvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = WIDTH / rect.width;
  const scaleY = HEIGHT / rect.height;
  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY,
  };
}

function handleCanvasPointer(event) {
  const point = getCanvasPoint(event);
  const button = getControlButtons().find((item) =>
    point.x >= item.x &&
    point.x <= item.x + item.w &&
    point.y >= item.y &&
    point.y <= item.y + item.h
  );

  if (!button) {
    return;
  }

  if (button.id === "pause") {
    togglePause();
  } else if (button.id === "restart") {
    restartGame();
  } else if (button.id === "fullscreen") {
    toggleFullscreen().catch(() => {});
  }
}

function resizeCanvasForDisplay() {
  const shell = document.querySelector(".canvas-shell");
  if (!shell) {
    return;
  }
  const viewportWidth = shell.clientWidth;
  const height = Math.round((viewportWidth / WIDTH) * HEIGHT);
  canvas.style.height = `${height}px`;
}

window.render_game_to_text = function renderGameToText() {
  return JSON.stringify({
    coordinateSystem: {
      origin: "top-left",
      xDirection: "right",
      yDirection: "down",
      units: "canvas pixels",
    },
    mode: state.mode,
    paused: state.paused,
    fullscreen: state.fullscreen,
    message: state.message,
    question: state.question ? {
      sparkId: state.question.sparkId,
      prompt: state.question.prompt,
      mode: state.question.mode,
      response: state.question.response,
      transcript: state.question.transcript,
      micState: state.question.micState,
      pitchHz: state.question.pitchHz,
    } : null,
    player: {
      x: Math.round(state.player.x),
        y: state.player.y,
        vx: Math.round(state.player.vx),
        facing: state.player.facing,
        immersion: Number(state.player.immersion.toFixed(2)),
      },
    objective: {
      sparksCollected: state.score,
      sparksTotal: TOTAL_SPARKS,
      shabbatActive: state.shabbat.active,
      shabbatTransition: Number(state.shabbat.transition.toFixed(2)),
      candlesVisible: state.shabbat.active,
    },
    visibleEntities: {
      ocean: {
        entryX: OCEAN_ENTRY_X,
        waterlineY: SEA_Y + 18,
      },
      sparks: (() => {
        const activeSpark = getActiveSpark();
        if (!activeSpark || activeSpark.collected) {
          return [];
        }
        return [{
          id: activeSpark.id,
          x: Math.round(activeSpark.x),
          y: Math.round(activeSpark.y + Math.sin(state.time * 1.8 + activeSpark.phase) * 12),
          imageIndex: activeSpark.imageIndex,
        }];
      })(),
    },
    controls: {
      move: ["ArrowLeft", "ArrowRight", "KeyA", "KeyD"],
      immersion: ["ArrowUp", "ArrowDown", "KeyW", "KeyS"],
      start: ["Space", "Enter"],
      answer: ["Type letters", "Space", "Backspace", "Enter"],
      voice: ["Speak into mic", "Press V to retry"],
      pause: "KeyP",
      restart: "KeyR",
      fullscreen: "KeyF",
      testAlt: "KeyB toggles pause/fullscreen normally and bypasses voice prompts only under webdriver",
    },
  }, null, 2);
};

window.advanceTime = async function advanceTime(ms) {
  manualStepMode = true;
  const step = 1000 / 60;
  const iterations = Math.max(1, Math.round(ms / step));
  for (let i = 0; i < iterations; i += 1) {
    update(1 / 60);
  }
  render();
};

questionSubmit.addEventListener("click", () => {
  if (!state.question || state.question.mode !== "text") {
    return;
  }
  state.question.response = questionInput.value;
  resolveSparkQuestion();
});

questionInput.addEventListener("input", () => {
  if (!state.question || state.question.mode !== "text") {
    return;
  }
  state.question.response = questionInput.value;
});

questionInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    if (state.question && state.question.mode === "text") {
      state.question.response = questionInput.value;
      resolveSparkQuestion();
    }
  }
});

micRetryButton.addEventListener("click", () => {
  if (!state.question || state.question.mode === "text") {
    return;
  }
  stopQuestionInput();
  state.question.micState = "starting";
  if (state.question.mode === "voice_phrase") {
    startVoicePhraseCapture();
  } else {
    startSingCapture();
  }
});

touchButtons.forEach((button) => {
  const control = button.dataset.control;
  const start = (event) => {
    event.preventDefault();
    pressVirtualControl(control);
  };
  const end = (event) => {
    event.preventDefault();
    releaseVirtualControl(control);
  };
  button.addEventListener("pointerdown", start);
  button.addEventListener("pointerup", end);
  button.addEventListener("pointercancel", end);
  button.addEventListener("pointerleave", end);
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}

startButton.addEventListener("click", startGame);
canvas.addEventListener("mousedown", handleCanvasPointer);
document.addEventListener("keydown", handleKeyDown);
document.addEventListener("keyup", handleKeyUp);
document.addEventListener("fullscreenchange", handleFullscreenChange);
window.addEventListener("beforeunload", stopQuestionInput);
window.addEventListener("resize", resizeCanvasForDisplay);

resizeCanvasForDisplay();
render();
window.requestAnimationFrame(loop);
