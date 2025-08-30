// src/translate.ts
export type Lang = "auto" | "ja" | "en";
export type Translator = "none" | "mock-tag" | "mini-dict";

type Dict = Record<string, string>;

const EN_JA: Dict = {
  hello: "こんにちは",
  hi: "やあ",
  "good morning": "おはようございます",
  "good evening": "こんばんは",
  "how are you": "お元気ですか",
  "thank you": "ありがとうございます",
  thanks: "ありがとう",
  please: "お願いします",
  sorry: "ごめんなさい",
  yes: "はい",
  no: "いいえ",
  ok: "OK",
  help: "助けて",
  doctor: "医者",
  hospital: "病院",
  ambulance: "救急車",
  pain: "痛み",
  headache: "頭痛",
  stomachache: "腹痛",
  allergy: "アレルギー",
  medicine: "薬",
  water: "水",
  food: "食べ物",
  toilet: "トイレ",
  restroom: "トイレ",
  where: "どこ",
  i: "私",
  you: "あなた",
};

const JA_EN: Dict = Object.fromEntries(
  Object.entries(EN_JA).map(([k, v]) => [v, k])
) as Dict;

/**
 * detect は "auto" を返さないので戻り値を "ja" | "en" に限定
 */
export function detect(text: string): Exclude<Lang, "auto"> {
  if (/[\u3040-\u30ff\u3400-\u9fff]/.test(text)) return "ja";
  return "en";
}

/** Lang（"auto"含む）を必ず "ja" | "en" に解決するヘルパ */
function resolveLang(lang: Lang, text: string): Exclude<Lang, "auto"> {
  return lang === "auto" ? detect(text) : lang;
}

/** 実際に分割を行う（Intl.Segmenter があれば使う） */
function segmentResolved(l: Exclude<Lang, "auto">, text: string): string[] {
  const has = (Intl as any).Segmenter;
  if (has) {
    const seg = new (Intl as any).Segmenter(l, { granularity: "word" });
    const out: string[] = [];
    for (const s of (seg as any).segment(text)) {
      const t = (s as any).segment ?? "";
      if (t.trim() !== "") out.push(t);
    }
    return out;
  }

  if (l === "ja") return text.split("");
  return text.split(/(\b|[\s,.!?;:]+)/g).filter((t) => t.trim() !== "");
}

/** 使いやすい wrapper（元のAPIと整合） */
function segment(lang: Lang, text: string): string[] {
  const l = resolveLang(lang, text);
  return segmentResolved(l, text);
}

function normalizeEnPhrase(
  tokens: string[],
  i: number,
  maxLen = 3
): [string, number] {
  for (let len = Math.min(maxLen, tokens.length - i); len >= 1; len--) {
    const phrase = tokens.slice(i, i + len).join(" ").toLowerCase();
    if (EN_JA[phrase]) return [phrase, len];
  }
  return [tokens[i].toLowerCase(), 1];
}

export async function translate(
  text: string,
  from: Lang,
  to: Lang,
  mode: Translator
): Promise<string> {
  // ※重要: ここで `to === "auto"` を判定して早期 return してしまうと
  // 後で `to === "auto"` をチェックできなくなり TS2367 が出るため除外している。
  if (mode === "none" || (from !== "auto" && from === to)) {
    return text;
  }

  // resolve src/tgt（"auto" を適切に解決）
  const src: Exclude<Lang, "auto"> = resolveLang(from, text);
  const tgt: Exclude<Lang, "auto"> =
    to === "auto" ? (src === "ja" ? "en" : "ja") : (to as Exclude<Lang, "auto">);

  if (mode === "mock-tag") {
    return tgt.toUpperCase() + ": " + text;
  }

  if (mode === "mini-dict") {
    if (src === tgt) return text;

    if (src === "en" && tgt === "ja") {
      const toks = segment("en", text);
      const out: string[] = [];
      for (let i = 0; i < toks.length; ) {
        const [ph, used] = normalizeEnPhrase(toks, i, 3);
        const m = EN_JA[ph];
        out.push(m ?? toks[i]);
        i += used;
      }
      return out.join("");
    }

    if (src === "ja" && tgt === "en") {
      const toks = segment("ja", text);
      const out: string[] = [];
      for (const t of toks) {
        out.push(JA_EN[t] ?? t);
      }
      return out.join(" ");
    }

    return text;
  }

  return text;
}
