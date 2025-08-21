export type Lang = "auto" | "ja" | "en";
export type Translator = "none" | "mock-tag" | "mini-dict";
type Dict = Record<string,string>;
const EN_JA: Dict = {"hello":"こんにちは","hi":"やあ","good morning":"おはようございます","good evening":"こんばんは","how are you":"お元気ですか","thank you":"ありがとうございます","thanks":"ありがとう","please":"お願いします","sorry":"ごめんなさい","yes":"はい","no":"いいえ","ok":"OK","help":"助けて","doctor":"医者","hospital":"病院","ambulance":"救急車","pain":"痛み","headache":"頭痛","stomachache":"腹痛","allergy":"アレルギー","medicine":"薬","water":"水","food":"食べ物","toilet":"トイレ","restroom":"トイレ","where":"どこ","i":"私","you":"あなた"};
const JA_EN: Dict = Object.fromEntries(Object.entries(EN_JA).map(([k,v])=>[v,k])) as Dict;
export function detect(text:string):Lang{ if(/[\u3040-\u30ff\u3400-\u9fff]/.test(text)) return "ja"; return "en"; }
function segment(lang:Lang,text:string){ const l=lang==="auto"?detect(text):lang; const has=(Intl as any).Segmenter;
  if(has){ const seg = new (Intl as any).Segmenter(l==="ja"?"ja":"en",{granularity:"word"}); const out:string[]=[]; for(const s of seg.segment(text)){ const t=(s as any).segment??""; if(t.trim()!=="") out.push(t);} return out; }
  if(l==="ja") return text.split(""); return text.split(/(\b|[\s,.!?;:]+)/g).filter(t=>t.trim()!==""); }
function normalizeEnPhrase(tokens:string[],i:number,maxLen=3):[string,number]{ for(let len=Math.min(maxLen,tokens.length-i); len>=1; len--){ const phrase=tokens.slice(i,i+len).join(" ").toLowerCase(); if(EN_JA[phrase]) return [phrase,len]; } return [tokens[i].toLowerCase(),1]; }
export async function translate(text:string, from:Lang, to:Lang, mode:Translator){ if(mode==="none"||to==="auto"||(from!=="auto"&&from===to)) return text;
  if(mode==="mock-tag"){ const src=from==="auto"?detect(text):from; const tgt=to==="auto"?(src==="ja"?"en":"ja"):to; return tgt.toUpperCase()+": "+text; }
  if(mode==="mini-dict"){ const src=from==="auto"?detect(text):from; const tgt=to==="auto"?(src==="ja"?"en":"ja"):to; if(src===tgt) return text;
    if(src==="en"&&tgt==="ja"){ const toks=segment("en",text); const out:string[]=[]; for(let i=0;i<toks.length;){ const [ph,used]=normalizeEnPhrase(toks,i,3); const m=EN_JA[ph]; out.push(m?m:toks[i]); i+=used;} return out.join(""); }
    if(src==="ja"&&tgt==="en"){ const toks=segment("ja",text); const out:string[]=[]; for(const t of toks){ const m=JA_EN[t]; out.push(m?m:t);} return out.join(" "); }
    return text; } return text; }
