const { app, BrowserWindow, globalShortcut, ipcMain, clipboard, screen, desktopCapturer, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');

let mainWindow = null;
let overlayWindow = null;

// 설정 파일 경로
const configPath = path.join(app.getPath('userData'), 'config.json');

function loadConfig() {
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (e) {}
  return {
    provider: 'anthropic',   // 'anthropic' | 'openai'
    anthropicKey: '',
    openaiKey: '',
    shortcut: 'CommandOrControl+Shift+C',
  };
}

function saveConfig(config) {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

let config = loadConfig();

// ── HTTP POST (Node 내장 https, 외부 라이브러리 불필요) ──────────────────────
function httpsPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const req = https.request(
      { hostname, path, method: 'POST', headers: { ...headers, 'Content-Length': Buffer.byteLength(bodyStr) } },
      (res) => {
        let data = '';
        res.on('data', chunk => (data += chunk));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try { resolve(JSON.parse(data)); }
            catch (e) { reject(new Error('응답 파싱 실패: ' + data)); }
          } else {
            let errMsg = `HTTP ${res.statusCode}`;
            try {
              const parsed = JSON.parse(data);
              errMsg = parsed?.error?.message || parsed?.error?.type || errMsg;
            } catch (_) {}
            reject(new Error(errMsg));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

// ── 메인 윈도우 ──────────────────────────────────────────────────────────────
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 420,
    height: 560,
    resizable: false,
    frame: false,
    transparent: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── 오버레이 윈도우 (드래그 선택) ────────────────────────────────────────────
function createOverlayWindow() {
  const { width, height } = screen.getPrimaryDisplay().bounds;

  overlayWindow = new BrowserWindow({
    x: 0,
    y: 0,
    width,
    height,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  overlayWindow.loadFile(path.join(__dirname, 'overlay.html'));
  overlayWindow.setIgnoreMouseEvents(false);
  overlayWindow.focus();

  overlayWindow.on('closed', () => {
    overlayWindow = null;
  });
}

// ── 스크린샷 캡처 → 특정 영역 크롭 ─────────────────────────────────────────
async function captureArea(rect) {
  const primaryDisplay = screen.getPrimaryDisplay();
  const scaleFactor = primaryDisplay.scaleFactor;

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: Math.round(primaryDisplay.bounds.width * scaleFactor),
      height: Math.round(primaryDisplay.bounds.height * scaleFactor),
    },
  });

  const source = sources.find(s => s.display_id === String(primaryDisplay.id)) || sources[0];
  if (!source) throw new Error('화면 캡처 소스를 찾을 수 없습니다.');

  const fullImg = source.thumbnail;

  // 크롭: scaleFactor 보정
  const cropped = fullImg.crop({
    x: Math.round(rect.x * scaleFactor),
    y: Math.round(rect.y * scaleFactor),
    width: Math.round(rect.width * scaleFactor),
    height: Math.round(rect.height * scaleFactor),
  });

  return cropped.toDataURL(); // base64 dataURL
}

// ── 프롬프트 정의 ────────────────────────────────────────────────────────────

// 일반 텍스트 모드: 유니코드 순수 텍스트
const PROMPT_PLAIN = `이미지에 보이는 텍스트를 그대로 추출하세요. 출력은 순수 텍스트(유니코드)만 허용합니다.

[절대 금지]
- LaTeX 문법 사용 금지: \\frac, \\sin, \\cos, \\pi, \\left, \\right, \\( \\), $ $, \\ 등 역슬래시(\\)로 시작하는 표현 일절 금지
- Markdown 문법 금지: **, __, ~~, # 등
- 설명·주석·번역 금지

[수식 표기 규칙 — 유니코드 텍스트로만]
- 분수: 이미지의 분수 기호를 슬래시로 → π/a, 2π/a, 7π/2
- 그리스 문자: 유니코드 그대로 → π, α, β, θ, Σ, Δ
- 수학 기호: ∈, ∉, ≤, ≥, ≠, ∞, √, ∫, ∑, ×, ÷
- 위첨자: 유니코드 위첨자 → x², a³, eˣ
- 아래첨자: 유니코드 아래첨자 → H₂O, CO₂
- 괄호: 이미지에 보이는 그대로 → [ ], ( ), { }
- sin, cos, tan, log 등 함수명: 영문 그대로
- 과학 단위: m/s², kg, Ω, μF, °C 등 유니코드로

[출력 형식]
- 인식된 텍스트만 출력 (설명 없이)
- 줄바꿈은 이미지 레이아웃 기준으로
- 텍스트가 없으면 빈 문자열 반환`;

// HWP 수식 모드: 한글(HWP) 수식 편집기용 출력
// 한글 수식 편집기: Ctrl+N, E 로 열고 붙여넣기
const PROMPT_HWP = `이미지에 보이는 텍스트를 추출하세요.
수식은 반드시 한글(HWP) 수식 편집기 문법으로, 일반 텍스트(한국어·영어)는 그대로 출력합니다.

[HWP 수식 문법 규칙 — LaTeX 절대 사용 금지]
- 분수: {분자} over {분모}
  예) π over a, {2π} over a, {7π} over 2, {-π} over 2
- 그리스 문자: 소문자 그대로 영문으로 → pi, alpha, beta, theta, sigma, delta, omega
  대문자: SIGMA, DELTA, PI
- 삼각함수: sin, cos, tan (백슬래시 없이)
- 위첨자: x^2, a^3, e^x  (중괄호 없이, 한 글자면 그냥)
  여러 글자: x^{n+1}
- 아래첨자: H_2O, CO_2
- 제곱근: sqrt x, sqrt {x+1}
- 절댓값: abs x
- 적분: int, oint
- 합: sum from {k=1} to {n}
- 극한: lim from {x -> 0}
- 수학 기호: <= , >= , != , inf , in , times , div , pm
- 괄호(자동 크기): left ( ... right ), left [ ... right ], left { ... right }
- 수식 내 띄어쓰기는 그대로 유지

[출력 예시]
이미지: [-π/a, 2π/a]에서 정의된 함수 f(x)=2sin(ax)+b
출력: left [ {-pi} over a , {2pi} over a right ] 에서 정의된 함수 f(x)=2sin(ax)+b

[일반 텍스트 규칙]
- 한국어·영어 문장은 수식 문법 없이 그대로 출력
- 번역 금지, 설명·주석 금지
- 인식된 내용만 출력 (설명 없이)
- 줄바꿈은 이미지 레이아웃 기준으로
- 텍스트가 없으면 빈 문자열 반환`;

// MS Word 수식 모드: Word UnicodeMath / LaTeX 수식 입력용
// Word에서: Alt+= 로 수식 블록 열고 붙여넣기
const PROMPT_WORD = `이미지에 보이는 텍스트를 추출하세요.
수식은 반드시 MS Word 수식 편집기에 바로 붙여넣을 수 있는 LaTeX 형식으로, 일반 텍스트(한국어·영어)는 그대로 출력합니다.

[Word 수식 LaTeX 규칙]
- 분수: \\frac{분자}{분모}
  예) \\frac{\\pi}{a}, \\frac{2\\pi}{a}, \\frac{-\\pi}{2}, \\frac{7\\pi}{2}
- 그리스 문자: \\pi, \\alpha, \\beta, \\theta, \\Sigma, \\Delta, \\omega
- 삼각함수: \\sin, \\cos, \\tan, \\log, \\ln
- 위첨자: x^{2}, a^{3}, e^{x}
- 아래첨자: H_{2}O, CO_{2}
- 제곱근: \\sqrt{x}, \\sqrt[n]{x}
- 적분: \\int_{a}^{b}
- 합: \\sum_{k=1}^{n}
- 극한: \\lim_{x \\to 0}
- 수학 기호: \\leq, \\geq, \\neq, \\infty, \\in, \\times, \\div, \\pm
- 괄호(크기 자동): \\left( \\right), \\left[ \\right], \\left\\{ \\right\\}
- 수식 블록: 인라인 수식은 $...$, 별도 줄 수식은 $$...$$

[출력 예시]
이미지: [-π/a, 2π/a]에서 정의된 함수 f(x)=2sin(ax)+b
출력: $\\left[-\\frac{\\pi}{a}, \\frac{2\\pi}{a}\\right]$에서 정의된 함수 $f(x)=2\\sin(ax)+b$

[일반 텍스트 규칙]
- 한국어·영어 문장은 LaTeX 없이 그대로 출력
- 번역 금지, 설명·주석 금지
- 인식된 내용만 출력 (설명 없이)
- 줄바꿈은 이미지 레이아웃 기준으로
- 텍스트가 없으면 빈 문자열 반환`;


async function callAnthropicOCR(base64Data, prompt) {
  if (!config.anthropicKey) throw new Error('Anthropic API 키가 설정되지 않았습니다.');

  const result = await httpsPost(
    'api.anthropic.com',
    '/v1/messages',
    {
      'x-api-key': config.anthropicKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    {
      model: 'claude-opus-4-5',
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: base64Data } },
          { type: 'text', text: prompt },
        ],
      }],
    }
  );

  const textBlock = result.content?.find(b => b.type === 'text');
  return textBlock ? textBlock.text.trim() : '';
}

// ── OpenAI GPT-4o mini Vision ────────────────────────────────────────────────
async function callOpenAIOCR(base64Data, prompt) {
  if (!config.openaiKey) throw new Error('OpenAI API 키가 설정되지 않았습니다.');

  const result = await httpsPost(
    'api.openai.com',
    '/v1/chat/completions',
    {
      'Authorization': `Bearer ${config.openaiKey}`,
      'content-type': 'application/json',
    },
    {
      model: 'gpt-4o-mini',
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:image/png;base64,${base64Data}`, detail: 'high' } },
          { type: 'text', text: prompt },
        ],
      }],
    }
  );

  return result.choices?.[0]?.message?.content?.trim() || '';
}

// ── 단일 호출 (프롬프트 지정) ────────────────────────────────────────────────
async function callOCRWithPrompt(base64Data, prompt) {
  if (config.provider === 'openai') return callOpenAIOCR(base64Data, prompt);
  return callAnthropicOCR(base64Data, prompt);
}

// ── 탭별 프롬프트 맵 ─────────────────────────────────────────────────────────
const PROMPTS = { plain: PROMPT_PLAIN, hwp: PROMPT_HWP, word: PROMPT_WORD };

// ── 세션 상태 (마지막 캡처 이미지 + 탭별 캐시) ──────────────────────────────
let lastBase64 = null;         // 마지막 캡처 이미지 (base64 data)
let resultCache = {};          // { plain: '...', hwp: '...', word: '...' }
let activeMode  = 'plain';     // 현재 선택된 탭 (기본값)

function clearSession() {
  lastBase64  = null;
  resultCache = {};
}

// ── IPC 핸들러 ───────────────────────────────────────────────────────────────
ipcMain.handle('open-overlay', async () => {
  const key = config.provider === 'openai' ? config.openaiKey : config.anthropicKey;
  if (!key) return { error: 'API 키를 먼저 설정해주세요.' };
  if (overlayWindow) return;
  if (mainWindow) mainWindow.hide();
  createOverlayWindow();
});

ipcMain.handle('overlay-cancel', () => {
  if (overlayWindow) { overlayWindow.close(); overlayWindow = null; }
  if (mainWindow) mainWindow.show();
});

ipcMain.handle('area-selected', async (event, rect) => {
  if (overlayWindow) { overlayWindow.close(); overlayWindow = null; }

  if (mainWindow) {
    mainWindow.show();
    mainWindow.webContents.send('ocr-start');
  }

  try {
    const dataUrl = await captureArea(rect);
    const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '');

    // 새 캡처 → 캐시 초기화 후 현재 탭만 호출
    clearSession();
    lastBase64 = base64Data;

    const text = await callOCRWithPrompt(base64Data, PROMPTS[activeMode]);
    resultCache[activeMode] = text;

    if (text) clipboard.writeText(text);

    if (mainWindow) {
      mainWindow.webContents.send('ocr-result', {
        mode: activeMode,
        text,
        copied: !!text,
      });
    }
  } catch (err) {
    if (mainWindow) mainWindow.webContents.send('ocr-error', err.message);
  }
});

// 탭 전환: 캐시 있으면 즉시 반환, 없으면 API 호출
ipcMain.handle('switch-tab', async (event, mode) => {
  activeMode = mode;

  // 캡처 이미지 없음 (아직 캡처 전)
  if (!lastBase64) return { mode, text: null, cached: false };

  // 캐시 히트
  if (resultCache[mode] !== undefined) {
    return { mode, text: resultCache[mode], cached: true };
  }

  // 캐시 미스 → API 호출
  try {
    const text = await callOCRWithPrompt(lastBase64, PROMPTS[mode]);
    resultCache[mode] = text;
    if (text) clipboard.writeText(text);
    return { mode, text, cached: false };
  } catch (err) {
    return { mode, text: null, error: err.message };
  }
});

ipcMain.handle('get-active-mode', () => activeMode);

ipcMain.handle('get-config', () => config);

ipcMain.handle('save-config', (event, newConfig) => {
  // 단축키 재등록
  if (newConfig.shortcut !== config.shortcut) {
    try {
      globalShortcut.unregister(config.shortcut);
      globalShortcut.register(newConfig.shortcut, triggerOCR);
    } catch (e) {
      return { error: '단축키 등록 실패: ' + e.message };
    }
  }
  config = { ...config, ...newConfig };
  saveConfig(config);
  return { ok: true };
});

ipcMain.handle('copy-text', (event, text) => {
  clipboard.writeText(text);
});

ipcMain.handle('minimize-window', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.handle('close-window', () => {
  app.quit();
});

// ── 단축키 트리거 ────────────────────────────────────────────────────────────
function triggerOCR() {
  const key = config.provider === 'openai' ? config.openaiKey : config.anthropicKey;
  if (!key) {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.webContents.send('ocr-error', 'API 키를 먼저 설정해주세요.');
    }
    return;
  }
  if (overlayWindow) return;
  if (mainWindow) mainWindow.hide();
  createOverlayWindow();
}

// ── 앱 초기화 ────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createMainWindow();

  // 전역 단축키 등록
  try {
    globalShortcut.register(config.shortcut || 'CommandOrControl+Shift+C', triggerOCR);
  } catch (e) {
    console.error('단축키 등록 실패:', e);
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  app.quit();
});
