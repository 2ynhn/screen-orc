# ScreenOCR

화면 영역을 드래그하여 텍스트를 인식하고 클립보드에 복사하는 도구입니다.  
수학·과학 기호 및 단위를 정확히 인식합니다.

## 특징

- 화면 위 드래그로 영역 선택
- Claude Vision API 기반 고정밀 OCR
- 수학 기호 (∑, ∫, √, π, ∞, ≤, ≥, ≠ 등) 정확 인식
- 과학 단위 (m/s², kg·m/s, Ω, μF, °C 등) 정확 인식
- 위·아래첨자 유니코드 표현 (x², H₂O)
- 인식 즉시 클립보드 자동 복사
- 전역 단축키 지원

## 설치 및 실행

```bash
npm install
npm start
```

## 빌드 (Windows .exe)

```bash
npm run build
```

`dist/` 폴더에 설치 파일이 생성됩니다.

## 사용법

1. 앱 실행 후 설정(⚙️)에서 **Anthropic API Key** 입력
2. `Ctrl+Shift+C` 또는 **영역 선택 후 OCR** 버튼 클릭
3. 화면 위를 드래그하여 인식할 영역 선택
4. 인식 결과가 표시되고 클립보드에 자동 복사됨

## 설정

| 항목 | 기본값 | 설명 |
|---|---|---|
| API Key | - | Anthropic API 키 (필수) |
| 단축키 | `CommandOrControl+Shift+C` | 전역 단축키 |

## 인식 잘 되는 콘텐츠

- 수식: `E = mc²`, `∫₀^∞ e^(-x²) dx = √π/2`
- 화학식: `H₂SO₄`, `CO₂`, `C₆H₁₂O₆`
- 단위: `9.8 m/s²`, `1.6×10⁻¹⁹ C`, `273.15 K`
- 일반 텍스트: 영문, 한글

## 요구사항

- Windows 10/11
- Node.js 18+
- Anthropic API Key
