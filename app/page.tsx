"use client";

import { useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, HelpCircle, Mic, Save, Square, Trash2 } from "lucide-react";
import { browserLocalPersistence, getRedirectResult, onAuthStateChanged, setPersistence, signInWithPopup, signInWithRedirect, signOut, type User } from "firebase/auth";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Calendar, CalendarDayButton } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Toaster } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import { createGoogleProvider, getFirebaseAuth } from "@/lib/firebase";
import { deleteCloudEntry, importCloudEntries, listCloudEntries, subscribeCloudEntries, upsertCloudEntry, type CloudDiaryEntry } from "@/lib/cloud-entries";

type Emotion = "happy" | "calm" | "excited" | "neutral" | "mixed" | "sad" | "angry" | "irritated";
type PeriodMode = "week" | "month";
type DiaryEntry = { date: string; emotion: Emotion; note: string; createdAt: string; updatedAt: string };
type EmotionDefinition = { value: Emotion; label: string; categoryLabel: string; emoji: string; gem: string; color: string; softColor: string; faceColor:string };

type BrowserSpeechRecognitionEvent = Event & { resultIndex:number; results:SpeechRecognitionResultList };
type BrowserSpeechRecognitionErrorEvent = Event & { error:string };
type BrowserSpeechRecognition = {
  lang:string; continuous:boolean; interimResults:boolean;
  start:()=>void; stop:()=>void; abort:()=>void;
  onstart:(event:Event)=>void; onend:(event:Event)=>void;
  onresult:(event:BrowserSpeechRecognitionEvent)=>void;
  onerror:(event:BrowserSpeechRecognitionErrorEvent)=>void;
};
type BrowserSpeechRecognitionConstructor = new()=>BrowserSpeechRecognition;

declare global { interface Window { SpeechRecognition?:BrowserSpeechRecognitionConstructor; webkitSpeechRecognition?:BrowserSpeechRecognitionConstructor } }

const STORAGE_KEY = "maeum-diary.entries.v1";
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const EMOTIONS: EmotionDefinition[] = [
  { value: "happy", label: "행복", categoryLabel: "밝은 마음 · 낮은 에너지", emoji: "🙂", gem: "토파즈", color: "#D5A037", softColor: "#F8F0DE", faceColor: "#FFFFFF" },
  { value: "excited", label: "설렘", categoryLabel: "밝은 마음 · 높은 에너지", emoji: "🤩", gem: "로즈쿼츠", color: "#CF8798", softColor: "#F6EAED", faceColor: "#FFFFFF" },
  { value: "calm", label: "평온", categoryLabel: "밝은 마음 · 낮은 에너지", emoji: "😌", gem: "에메랄드", color: "#309071", softColor: "#E2F0EA", faceColor: "#FFFFFF" },
  { value: "neutral", label: "평범", categoryLabel: "잔잔한 마음 · 낮은 에너지", emoji: "😐", gem: "문스톤", color: "#829694", softColor: "#EAF0EF", faceColor: "#FFFFFF" },
  { value: "mixed", label: "복잡", categoryLabel: "잔잔한 마음 · 높은 에너지", emoji: "😵‍💫", gem: "오팔", color: "#806E99", softColor: "#EEEAF2", faceColor: "#FFFFFF" },
  { value: "sad", label: "우울", categoryLabel: "짙은 마음 · 낮은 에너지", emoji: "😔", gem: "사파이어", color: "#496DA7", softColor: "#E7EBF3", faceColor: "#FFFFFF" },
  { value: "irritated", label: "짜증", categoryLabel: "짙은 마음 · 높은 에너지", emoji: "😤", gem: "앰버", color: "#C57443", softColor: "#F5E9E2", faceColor: "#FFFFFF" },
  { value: "angry", label: "화남", categoryLabel: "짙은 마음 · 높은 에너지", emoji: "😠", gem: "루비", color: "#AF4559", softColor: "#F3E5E8", faceColor: "#FFFFFF" },
];
const EMOTION_MAP = Object.fromEntries(EMOTIONS.map((item) => [item.value, item])) as Record<Emotion, EmotionDefinition>;
const EMOTION_VALUES = EMOTIONS.map((item) => item.value);
const MOOD_MAP_ROWS: Emotion[][] = [["angry", "irritated", "mixed", "excited"], ["sad", "neutral", "calm", "happy"]];
const HIGH_ENERGY = new Set<Emotion>(MOOD_MAP_ROWS[0]);
const MOOD_POSITION = Object.fromEntries(MOOD_MAP_ROWS.flatMap((row,rowIndex)=>row.map((emotion,columnIndex)=>[emotion,{x:12+columnIndex*25.3,y:rowIndex===0?23:77}]))) as Record<Emotion,{x:number;y:number}>;

function toDateKey(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function fromDateKey(value: string) { const [y, m, d] = value.split("-").map(Number); return new Date(y, m - 1, d); }
function formatDate(value: string) { const d = fromDateKey(value); return `${d.getMonth() + 1}월 ${d.getDate()}일 ${WEEKDAYS[d.getDay()]}요일`; }
function startOfWeek(date: Date) { const d = new Date(date.getFullYear(), date.getMonth(), date.getDate()); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d; }
function periodBounds(mode: PeriodMode, anchor: Date) {
  if (mode === "week") { const start = startOfWeek(anchor), end = new Date(start); end.setDate(end.getDate() + 6); return { start, end }; }
  return { start: new Date(anchor.getFullYear(), anchor.getMonth(), 1), end: new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0) };
}
function periodLabel(mode: PeriodMode, start: Date, end: Date) {
  if (mode === "month") return `${start.getFullYear()}년 ${start.getMonth() + 1}월`;
  return start.getMonth() === end.getMonth() ? `${start.getFullYear()}년 ${start.getMonth() + 1}월 ${start.getDate()}일–${end.getDate()}일` : `${start.getMonth() + 1}월 ${start.getDate()}일–${end.getMonth() + 1}월 ${end.getDate()}일`;
}
function isEmotion(value: unknown): value is Emotion { return EMOTION_VALUES.includes(value as Emotion); }
function isEntry(value: unknown): value is DiaryEntry {
  if (!value || typeof value !== "object") return false;
  const e = value as Partial<DiaryEntry>;
  return /^\d{4}-\d{2}-\d{2}$/.test(e.date ?? "") && isEmotion(e.emotion) && typeof e.note === "string" && e.note.trim().length > 0 && e.note.length <= 100 && typeof e.createdAt === "string" && typeof e.updatedAt === "string";
}

function mergeSpeechParts(current: string, incoming: string) {
  const left=current.trim().replace(/\s+/g," "),right=incoming.trim().replace(/\s+/g," ");
  if(!left)return right;
  if(!right||left===right||left.endsWith(right))return left;
  if(right.startsWith(left))return right;
  const leftWords=left.split(" "),rightWords=right.split(" "),maxOverlap=Math.min(leftWords.length,rightWords.length);
  for(let size=maxOverlap;size>0;size--){
    if(leftWords.slice(-size).join(" ")===rightWords.slice(0,size).join(" "))return [...leftWords,...rightWords.slice(size)].join(" ");
  }
  return `${left} ${right}`;
}

// 추후 로그인 저장소로 교체할 수 있도록 브라우저 저장을 UI에서 분리한다.
const entryStore = {
  list(): DiaryEntry[] {
    if (typeof window === "undefined") return [];
    try { const data = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]"); return Array.isArray(data) ? data.filter(isEntry) : []; } catch { return []; }
  },
  write(entries: DiaryEntry[]) { localStorage.setItem(STORAGE_KEY, JSON.stringify(entries)); },
  upsert(entries: DiaryEntry[], date: string, emotion: Emotion, note: string) {
    const old = entries.find((entry) => entry.date === date), now = new Date().toISOString();
    const next = { date, emotion, note: note.trim(), createdAt: old?.createdAt ?? now, updatedAt: now };
    return [...entries.filter((entry) => entry.date !== date), next].sort((a, b) => b.date.localeCompare(a.date));
  },
  remove(entries: DiaryEntry[], date: string) { return entries.filter((entry) => entry.date !== date); },
};

type Oklch = { l: number; c: number; h: number };
function hexToOklch(hex: string): Oklch {
  const rgb = [0, 2, 4].map((i) => parseInt(hex.slice(1 + i, 3 + i), 16) / 255);
  const [r, g, b] = rgb.map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  const lr = Math.cbrt(.4122214708*r + .5363325363*g + .0514459929*b), mr = Math.cbrt(.2119034982*r + .6806995451*g + .1073969566*b), sr = Math.cbrt(.0883024619*r + .2817188376*g + .6299787005*b);
  const l = .2104542553*lr + .793617785*mr - .0040720468*sr, a = 1.9779984951*lr - 2.428592205*mr + .4505937099*sr, bb = .0259040371*lr + .7827717662*mr - .808675766*sr;
  const h = Math.atan2(bb, a) * 180 / Math.PI;
  return { l, c: Math.sqrt(a*a + bb*bb), h: h < 0 ? h + 360 : h };
}
function oklchToHex({ l, c, h }: Oklch) {
  const rad = h*Math.PI/180, a = c*Math.cos(rad), b = c*Math.sin(rad), lr = l+.3963377774*a+.2158037573*b, mr = l-.1055613458*a-.0638541728*b, sr = l-.0894841775*a-1.291485548*b;
  const l3=lr**3,m3=mr**3,s3=sr**3, values=[4.0767416621*l3-3.3077115913*m3+.2309699292*s3,-1.2684380046*l3+2.6097574011*m3-.3413193965*s3,-.0041960863*l3-.7034186147*m3+1.707614701*s3];
  return `#${values.map((v)=>{v=Math.max(0,Math.min(1,v));const e=v<=.0031308?12.92*v:1.055*v**(1/2.4)-.055;return Math.round(e*255).toString(16).padStart(2,"0");}).join("")}`;
}
function averageColor(entries: DiaryEntry[]) {
  if (!entries.length) return "#DCE5E7";
  const colors=entries.map((e)=>hexToOklch(EMOTION_MAP[e.emotion].color));
  const l=colors.reduce((sum,value)=>sum+value.l,0)/colors.length;
  const x=colors.reduce((sum,value)=>sum+value.c*Math.cos(value.h*Math.PI/180),0)/colors.length;
  const y=colors.reduce((sum,value)=>sum+value.c*Math.sin(value.h*Math.PI/180),0)/colors.length;
  const c=Math.sqrt(x*x+y*y);
  const h=c<.008?235:(Math.atan2(y,x)*180/Math.PI+360)%360;
  return oklchToHex({l,c:Math.max(.012,c),h});
}

function GemFace({ emotion, color }: { emotion:Emotion; color:string }) {
  const eyes=emotion==="happy"||emotion==="calm"?<><path d="M36 45q4 3 8 0"/><path d="M56 45q4 3 8 0"/></>:emotion==="angry"?<><path d="m35 40 10 4"/><path d="m65 40-10 4"/><circle cx="41" cy="49" r="2.7" fill="currentColor" stroke="none"/><circle cx="59" cy="49" r="2.7" fill="currentColor" stroke="none"/></>:emotion==="irritated"?<><path d="m35 44 10-3"/><path d="m65 44-10-3"/></>:emotion==="mixed"?<><path d="M35 45q4 3 8 0"/><circle cx="60" cy="46" r="2.8" fill="currentColor" stroke="none"/></>:<><circle cx="40" cy="46" r="2.8" fill="currentColor" stroke="none"/><circle cx="60" cy="46" r="2.8" fill="currentColor" stroke="none"/></>;
  const mouth=emotion==="happy"?<path d="M39 56q11 11 22 0"/>:emotion==="excited"?<circle cx="50" cy="59" r="6.5"/>:emotion==="calm"?<path d="M42 57q8 5 16 0"/>:emotion==="neutral"?<path d="M42 59h16"/>:emotion==="mixed"?<path d="M40 59q5-5 10 0t10 0"/>:emotion==="sad"?<path d="M40 64q10-10 20 0"/>:emotion==="irritated"?<path d="M41 59h18"/>:<path d="M40 64q10-9 20 0"/>;
  return <g color={color} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="4.2">{eyes}{mouth}</g>;
}

function GemStone({ color, secondaryColor, size=48, label, className, expression }: { color:string; secondaryColor?:string; size?:number; label?:string; className?:string; expression?:Emotion }) {
  const face=expression?EMOTION_MAP[expression]:null;
  return <svg viewBox="0 0 100 92" width={size} height={size*.92} role={label?"img":undefined} aria-label={label} aria-hidden={label?undefined:true} className={cn("drop-shadow-[0_8px_12px_rgba(93,77,99,0.16)]",className)}>
    <path d="M18 9h64l16 26-48 54L2 35 18 9Z" fill={color}/><path d="M18 9 34 35 2 35 18 9Z" fill="#fff" opacity=".46"/><path d="m18 9 32 0-16 26L18 9Z" fill="#fff" opacity=".2"/><path d="m50 9 32 0-16 26L50 9Z" fill={secondaryColor??color} opacity=".7"/><path d="m82 9 16 26H66L82 9Z" fill="#fff" opacity=".18"/><path d="M2 35h32l16 54L2 35Z" fill={secondaryColor??color} opacity=".58"/><path d="M34 35h32L50 89 34 35Z" fill="#fff" opacity=".24"/><path d="M66 35h32L50 89l16-54Z" fill="#2f2733" opacity=".12"/>{face&&<path d="M32 36h36l-5 27-13 15-13-15-5-27Z" fill="#202A31" opacity=".52"/>}<path d="M18 9h64l16 26-48 54L2 35 18 9Z" fill="none" stroke="#fff" strokeOpacity=".56" strokeWidth="2"/>{face&&<GemFace emotion={face.value} color="#FFFFFF"/>} 
  </svg>;
}
function MoodDayButton({ entriesByDate, ...props }: ComponentProps<typeof CalendarDayButton> & { entriesByDate: Map<string,DiaryEntry> }) {
  const entry=entriesByDate.get(toDateKey(props.day.date)), item=entry?EMOTION_MAP[entry.emotion]:null;
  return <CalendarDayButton {...props} aria-label={item?`${props.day.date.getDate()}일, ${item.label}`:props["aria-label"]} className={cn(props.className,"relative !items-start !justify-start !gap-0 overflow-hidden rounded-[17px] border border-white/60 bg-white/30 !p-1.5 text-base shadow-[inset_0_1px_0_rgba(255,255,255,.76)] transition hover:-translate-y-0.5 hover:bg-white/65 md:!p-2 md:text-lg",item&&"font-semibold")} style={item?{background:`radial-gradient(circle at 76% 72%, ${item.color}42 0, transparent 48%), linear-gradient(145deg, rgba(255,255,255,.9), ${item.softColor})`,color:"#4A454B",boxShadow:props.modifiers.selected?`inset 0 0 0 2px #526B78,0 8px 18px ${item.color}25`:`inset 0 0 0 1px ${item.color}38,0 7px 16px ${item.color}20`}:props.style}>
    <span className="relative z-10 !text-base font-bold !opacity-100 md:!text-lg">{props.day.date.getDate()}</span>{item&&<><span className="absolute right-2 top-1.5 size-1 rounded-full bg-white shadow-[0_0_7px_2px_white]"/><GemStone color={item.color} expression={item.value} size={28} className="absolute -bottom-0.5 -right-0.5 !h-auto !w-7 md:bottom-0 md:right-0 md:!w-9"/></>}
  </CalendarDayButton>;
}

function EnergyAnalysis({ entries, counts }: { entries:DiaryEntry[]; counts:Record<Emotion,number> }) {
  const high=entries.filter((entry)=>HIGH_ENERGY.has(entry.emotion)).length,low=entries.length-high,total=entries.length;
  const highPercent=total?Math.round(high/total*100):50;
  const chronological=[...entries].sort((a,b)=>a.date.localeCompare(b.date));
  const points=chronological.map((entry)=>MOOD_POSITION[entry.emotion]);
  const energyCopy=!total?"마음빛을 모으면 에너지의 흐름이 보여요.":high===low?"활발한 마음과 잔잔한 마음이 고르게 머물렀어요.":high>low?"움직임이 큰, 활발한 마음이 조금 더 많았어요.":"천천히 가라앉는, 잔잔한 마음이 조금 더 많았어요.";
  return <section className="mt-5 grid w-full min-w-0 max-w-full gap-4 lg:h-[326px] lg:grid-cols-[minmax(0,.72fr)_minmax(0,1.28fr)]" aria-label="마음 에너지 분석">
    <div className="min-w-0 max-w-full overflow-hidden rounded-[24px] border border-white/85 bg-white/62 p-5 shadow-[0_12px_36px_rgba(66,87,96,.07)] lg:h-full">
      <p className="text-xs font-bold tracking-[.14em] text-[#7B8D94]">ENERGY BALANCE</p><h3 className="mt-1 text-lg font-bold text-[#3F4D54]">마음의 에너지</h3>
      <div className="mt-6 flex items-end justify-between"><div><span className="text-sm font-semibold text-[#99606A]">높은 에너지</span><strong className="mt-1 block text-3xl text-[#4B5960]">{total?highPercent:0}%</strong></div><div className="text-right"><span className="text-sm font-semibold text-[#5E7E92]">낮은 에너지</span><strong className="mt-1 block text-3xl text-[#4B5960]">{total?100-highPercent:0}%</strong></div></div>
      <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-[#E8EFF1]" aria-label={`높은 에너지 ${high}일, 낮은 에너지 ${low}일`}><span className="bg-[linear-gradient(90deg,#B46B5D,#9A6D91)] transition-all" style={{width:total?`${highPercent}%`:"0%"}}/><span className="flex-1 bg-[linear-gradient(90deg,#7192A7,#73A59C)]"/></div>
      <div className="mt-2 flex justify-between text-xs font-semibold text-[#859299]"><span>{high}일</span><span>{low}일</span></div><p className="mt-5 text-sm leading-6 text-[#687981]">{energyCopy}</p>
    </div>
    <div className="min-w-0 max-w-full overflow-hidden rounded-[24px] border border-white/85 bg-white/62 p-5 shadow-[0_12px_36px_rgba(66,87,96,.07)] lg:h-full">
      <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold tracking-[.14em] text-[#7B8D94]">MOOD JOURNEY</p><h3 className="mt-1 text-lg font-bold text-[#3F4D54]">마음의 궤적</h3></div><p className="max-w-40 text-right text-xs leading-5 text-[#839198]">날짜 순서대로 이어진 마음빛이에요</p></div>
      <div className="relative mt-4 h-56 overflow-hidden rounded-[20px] border border-[#DFE8EA] bg-[linear-gradient(180deg,rgba(247,232,234,.68),rgba(250,252,252,.8)_49%,rgba(229,240,244,.76))]">
        <div className="absolute inset-x-4 top-1/2 border-t border-dashed border-[#AABAC0]/65"/><div className="absolute inset-y-4 left-1/2 border-l border-dashed border-[#AABAC0]/65"/>
        <span className="absolute left-3 top-2 text-[10px] font-bold text-[#9A747C]">높은 에너지</span><span className="absolute bottom-2 left-3 text-[10px] font-bold text-[#6D8796]">낮은 에너지</span><span className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[10px] font-semibold text-[#829097]">불쾌 ←　→ 쾌</span>
        {points.length>1&&<svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden="true"><polyline points={points.map((point)=>`${point.x},${point.y}`).join(" ")} fill="none" stroke="#718B96" strokeOpacity=".48" strokeWidth="1.3" strokeDasharray="2.4 2.4" vectorEffect="non-scaling-stroke"/></svg>}
        {EMOTIONS.map((item)=>{const amount=counts[item.value];if(!amount)return null;const point=MOOD_POSITION[item.value],size=Math.min(48,32+(amount-1)*4);return <div key={item.value} className="absolute -translate-x-1/2 -translate-y-1/2" style={{left:`${point.x}%`,top:`${point.y}%`}}><div className="relative"><GemStone color={item.color} expression={item.value} size={size} label={`${item.label} ${amount}번`}/>{amount>1&&<span className="absolute -right-1 -top-1 grid size-5 place-items-center rounded-full bg-white text-[10px] font-bold text-[#526168] shadow-sm">{amount}</span>}</div></div>})}
        {!total&&<div className="absolute inset-0 grid place-items-center"><p className="rounded-full bg-white/80 px-4 py-2 text-sm font-semibold text-[#7A898F]">아직 그려진 궤적이 없어요</p></div>}
      </div>
    </div>
  </section>;
}

function AccountButton(_: { user:User|null; ready:boolean; busy:boolean; onSignIn:()=>void; onSignOut:()=>void }) {
  return null;
}

export default function MoodDiary() {
  const today=useMemo(()=>{const d=new Date();return new Date(d.getFullYear(),d.getMonth(),d.getDate());},[]), todayKey=useMemo(()=>toDateKey(today),[today]);
  const [entries,setEntries]=useState<DiaryEntry[]>([]),[hydrated,setHydrated]=useState(false),[mainTab,setMainTab]=useState("record"),[selectedDate,setSelectedDate]=useState(todayKey),[calendarMonth,setCalendarMonth]=useState(new Date(today.getFullYear(),today.getMonth(),1));
  const [emotion,setEmotion]=useState<Emotion|null>(null),[note,setNote]=useState(""),[mode,setMode]=useState<PeriodMode>("week"),[anchor,setAnchor]=useState(today),[filter,setFilter]=useState<"all"|Emotion>("all"),[error,setError]=useState("");
  const [user,setUser]=useState<User|null>(null),[authReady,setAuthReady]=useState(false),[authBusy,setAuthBusy]=useState(false);
  const [dataBusy,setDataBusy]=useState(false),[importOpen,setImportOpen]=useState(false),[importBusy,setImportBusy]=useState(false),[pendingLocal,setPendingLocal]=useState<DiaryEntry[]>([]);
  const [recording,setRecording]=useState(false),[voiceMessage,setVoiceMessage]=useState("");
  const recognitionRef=useRef<BrowserSpeechRecognition|null>(null),speechBaseRef=useRef(""),speechLatestRef=useRef("");
  const byDate=useMemo(()=>new Map(entries.map((e)=>[e.date,e])),[entries]), selectedEntry=byDate.get(selectedDate);
  const calendarMonthCount=useMemo(()=>{const prefix=`${calendarMonth.getFullYear()}-${String(calendarMonth.getMonth()+1).padStart(2,"0")}-`;return entries.filter((entry)=>entry.date.startsWith(prefix)).length;},[entries,calendarMonth]);
  useEffect(()=>{setEntries(entryStore.list());setHydrated(true);},[]);
  useEffect(()=>()=>{recognitionRef.current?.abort();},[]);
  useEffect(()=>{const current=byDate.get(selectedDate);setEmotion(current?.emotion??null);setNote(current?.note??"");setError("");},[byDate,selectedDate]);
  useEffect(()=>{
    const auth=getFirebaseAuth();let active=true;
    void setPersistence(auth,browserLocalPersistence).then(()=>getRedirectResult(auth)).catch(()=>{if(active)toast.error("로그인 상태를 확인하지 못했어요. 다시 시도해 주세요.");});
    const unsubscribe=onAuthStateChanged(auth,(nextUser)=>{if(!active)return;setUser(nextUser);setAuthReady(true);setAuthBusy(false);});
    return()=>{active=false;unsubscribe();};
  },[]);
  useEffect(()=>{
    if(!authReady)return;
    if(!user){setEntries(entryStore.list());setHydrated(true);setDataBusy(false);return;}
    setHydrated(false);setDataBusy(true);
    const localEntries=entryStore.list(),importKey=`maeum-diary.import-offered.${user.uid}`;
    if(localEntries.length>0&&!localStorage.getItem(importKey)){setPendingLocal(localEntries);setImportOpen(true);}
    return subscribeCloudEntries(user.uid,(cloudEntries)=>{setEntries(cloudEntries.filter(isEntry));setHydrated(true);setDataBusy(false);},()=>{setHydrated(true);setDataBusy(false);toast.error("계정의 기록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");});
  },[authReady,user]);

  useEffect(()=>{
    const context=(document as Document&{modelContext?:{registerTool:(tool:{name:string;title:string;description:string;inputSchema:object;annotations:{readOnlyHint:boolean;untrustedContentHint:boolean};execute:(input:Record<string,unknown>)=>unknown},options?:{signal?:AbortSignal})=>void|Promise<void>}}).modelContext;
    if(!context?.registerTool)return;const lifecycle=new AbortController();
    const register=(tool:Parameters<typeof context.registerTool>[0])=>{try{void Promise.resolve(context.registerTool(tool,{signal:lifecycle.signal})).catch(()=>undefined);}catch{/* optional */}};
    register({name:"list_mood_entries",title:"마음빛 기록 조회",description:"현재 보석함의 감정 기록을 조회합니다.",inputSchema:{type:"object",properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},execute:async()=>({entries:user?await listCloudEntries(user.uid):entryStore.list()})});
    register({name:"save_mood_entry",title:"마음빛 기록 저장",description:"날짜별 감정과 메모를 저장하거나 수정합니다.",inputSchema:{type:"object",properties:{date:{type:"string"},emotion:{enum:EMOTION_VALUES},note:{type:"string",minLength:1,maxLength:100}},required:["date","emotion","note"],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute:async(input)=>{const date=String(input.date??""),mood=input.emotion,text=String(input.note??"").trim();if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date>todayKey||!isEmotion(mood)||!text||text.length>100)throw new Error("입력을 확인해 주세요.");if(user){const now=new Date().toISOString();await upsertCloudEntry(user.uid,{date,emotion:mood,note:text,createdAt:now,updatedAt:now});}else{const next=entryStore.upsert(entryStore.list(),date,mood,text);entryStore.write(next);setEntries(next);}return{saved:true,date};}});
    register({name:"delete_mood_entry",title:"마음빛 기록 삭제",description:"선택한 날짜의 기록을 삭제합니다.",inputSchema:{type:"object",properties:{date:{type:"string"}},required:["date"],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute:async(input)=>{const date=String(input.date??"");if(user)await deleteCloudEntry(user.uid,date);else{const next=entryStore.remove(entryStore.list(),date);entryStore.write(next);setEntries(next);}return{deleted:true,date};}});
    return()=>lifecycle.abort();
  },[todayKey,user]);

  const bounds=useMemo(()=>periodBounds(mode,anchor),[mode,anchor]);
  const periodEntries=useMemo(()=>{const start=toDateKey(bounds.start),end=toDateKey(bounds.end>today?today:bounds.end);return entries.filter((e)=>e.date>=start&&e.date<=end).sort((a,b)=>b.date.localeCompare(a.date));},[entries,bounds,today]);
  const counts=useMemo(()=>EMOTIONS.reduce((r,item)=>{r[item.value]=periodEntries.filter((e)=>e.emotion===item.value).length;return r;},{} as Record<Emotion,number>),[periodEntries]);
  const ranked=useMemo(()=>EMOTIONS.filter((item)=>counts[item.value]>0).sort((a,b)=>counts[b.value]-counts[a.value]),[counts]);
  const leaders=useMemo(()=>ranked.length?ranked.filter((item)=>counts[item.value]===counts[ranked[0].value]):[],[ranked,counts]);
  const dominant=leaders.length===1?leaders[0]:null,secondary=ranked.find((item)=>item.value!==dominant?.value)??dominant;
  const periodColor=useMemo(()=>averageColor(periodEntries),[periodEntries]),visible=useMemo(()=>filter==="all"?periodEntries:periodEntries.filter((e)=>e.emotion===filter),[periodEntries,filter]),canNext=bounds.end<today;
  function movePeriod(direction:-1|1){if(direction===1&&!canNext)return;const next=new Date(anchor);mode==="week"?next.setDate(next.getDate()+direction*7):next.setMonth(next.getMonth()+direction);setAnchor(next);}
  function stopRecording(){recognitionRef.current?.stop();}
  function startRecording(){
    const Recognition=window.SpeechRecognition??window.webkitSpeechRecognition;
    if(!Recognition){setError("이 브라우저는 음성 받아쓰기를 지원하지 않아요. 최신 Chrome이나 Edge에서 이용해 주세요.");return;}
    const recognition=new Recognition();recognitionRef.current=recognition;speechBaseRef.current=note.trim();speechLatestRef.current=note.trim();
    recognition.lang="ko-KR";recognition.continuous=true;recognition.interimResults=true;
    recognition.onstart=()=>{setRecording(true);setVoiceMessage("듣고 있어요. 말하면 바로 글로 적혀요.");setError("");};
    recognition.onresult=(event)=>{let finalized="",interim="";for(let i=0;i<event.results.length;i++){const transcript=event.results[i][0]?.transcript??"";if(event.results[i].isFinal)finalized=mergeSpeechParts(finalized,transcript);else interim=mergeSpeechParts(interim,transcript);}const spoken=mergeSpeechParts(finalized,interim),combined=mergeSpeechParts(speechBaseRef.current,spoken),next=combined.slice(0,100);speechLatestRef.current=next;setNote(next);setVoiceMessage(combined.length>100?"100자가 되어 받아쓰기를 멈췄어요.":interim?"듣고 있어요. 말하면 바로 글로 적혀요.":"말한 내용을 일기에 적었어요.");if(combined.length>=100)recognition.stop();};
    recognition.onerror=(event)=>{const messages:Record<string,string>={"not-allowed":"마이크 권한이 필요해요. 브라우저 설정에서 허용해 주세요.","audio-capture":"사용할 수 있는 마이크를 찾지 못했어요.","no-speech":"말소리가 들리지 않았어요. 다시 눌러 말해 주세요.","network":"음성 인식 연결이 원활하지 않아요. 잠시 후 다시 시도해 주세요."};setError(messages[event.error]??"음성을 인식하지 못했어요. 다시 시도해 주세요.");setVoiceMessage("");};
    recognition.onend=()=>{setRecording(false);recognitionRef.current=null;};
    try{recognition.start();}catch{setError("음성 받아쓰기를 시작하지 못했어요. 잠시 후 다시 시도해 주세요.");}
  }
  async function save(){const text=note.trim();if(!emotion)return setError("오늘의 마음과 가장 가까운 감정을 골라주세요.");if(!text)return setError("마음에 담긴 이야기를 짧게 남겨주세요.");const mood=emotion,existed=Boolean(selectedEntry);setDataBusy(true);try{if(user){const old=entries.find((entry)=>entry.date===selectedDate),now=new Date().toISOString();await upsertCloudEntry(user.uid,{date:selectedDate,emotion:mood,note:text,createdAt:old?.createdAt??now,updatedAt:now});}else{const next=entryStore.upsert(entries,selectedDate,mood,text);entryStore.write(next);setEntries(next);}setNote(text);setError("");toast.success(existed?"마음빛을 새롭게 다듬었어요.":"오늘의 마음빛을 간직했어요.");}catch{setError("저장하지 못했어요. 입력 내용은 그대로 두었으니 다시 시도해 주세요.");}finally{setDataBusy(false);}}
  async function remove(){setDataBusy(true);try{if(user)await deleteCloudEntry(user.uid,selectedDate);else{const next=entryStore.remove(entries,selectedDate);entryStore.write(next);setEntries(next);}setEmotion(null);setNote("");toast.success("이날의 마음 기록을 비웠어요.");}catch{setError("삭제하지 못했어요. 잠시 후 다시 시도해 주세요.");}finally{setDataBusy(false);}}
  async function importLocal(){if(!user||!pendingLocal.length)return;setImportBusy(true);try{const result=await importCloudEntries(user.uid,pendingLocal);localStorage.setItem(`maeum-diary.import-offered.${user.uid}`,"imported");setImportOpen(false);toast.success(result.skipped?`${result.imported}개를 가져왔어요. 계정에 있던 ${result.skipped}개 기록은 유지했어요.`:`브라우저 기록 ${result.imported}개를 계정으로 가져왔어요.`);}catch{toast.error("기록을 가져오지 못했어요. 다시 시도해 주세요.");}finally{setImportBusy(false);}}
  function dismissImport(){if(user)localStorage.setItem(`maeum-diary.import-offered.${user.uid}`,"dismissed");setImportOpen(false);}
  async function login(){setAuthBusy(true);try{const auth=getFirebaseAuth();await setPersistence(auth,browserLocalPersistence);await signInWithPopup(auth,createGoogleProvider());toast.success("Google 계정으로 로그인했어요.");}catch(reason){const code=(reason as {code?:string}).code;if(code==="auth/popup-blocked"||code==="auth/operation-not-supported-in-this-environment"){await signInWithRedirect(getFirebaseAuth(),createGoogleProvider());return;}if(code!=="auth/popup-closed-by-user")toast.error("로그인하지 못했어요. 잠시 후 다시 시도해 주세요.");setAuthBusy(false);}}
  async function logout(){setAuthBusy(true);try{await signOut(getFirebaseAuth());toast.success("로그아웃했어요. 브라우저 기록은 그대로 남아 있어요.");}catch{toast.error("로그아웃하지 못했어요. 다시 시도해 주세요.");setAuthBusy(false);}}
  const nav=()=>{
    const triggerClass="app-tab-trigger min-h-0 items-center justify-center rounded-full border-0 px-5 py-0 text-[15px] font-semibold leading-none outline-none focus-visible:outline-none focus-visible:ring-0";
    return <div className="border-b border-[#DDE2E0] bg-white/58 backdrop-blur-xl"><TabsList aria-label="화면 선택" className="app-tabs-list app-tabs-list--top mx-auto grid bg-transparent p-0"><TabsTrigger value="record" className={triggerClass}>기록</TabsTrigger><TabsTrigger value="jewels" className={triggerClass}>보석함</TabsTrigger><TabsTrigger value="account" className={cn(triggerClass,"app-tab-trigger--account")}>{user?"내 계정":"로그인"}</TabsTrigger></TabsList></div>;
  };

  return <main className="gem-background min-h-screen overflow-x-clip pb-12 text-[#344249]"><Toaster position="top-center"/>
    <AlertDialog open={importOpen} onOpenChange={(open)=>{if(!open&&!importBusy)dismissImport();}}><AlertDialogContent className="rounded-[24px] bg-[#FFFCFA]"><AlertDialogHeader><AlertDialogTitle>브라우저 기록을 계정으로 가져올까요?</AlertDialogTitle><AlertDialogDescription>이 브라우저에 저장된 {pendingLocal.length}개의 마음 기록을 계정 보석함에 더합니다. 같은 날짜에 계정 기록이 있으면 기존 계정 기록을 유지해요.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel onClick={dismissImport} disabled={importBusy}>브라우저에만 두기</AlertDialogCancel><AlertDialogAction onClick={importLocal} disabled={importBusy} className="bg-[#6F6078] hover:bg-[#5E5067]">{importBusy?"가져오는 중...":"계정으로 가져오기"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <Tabs value={mainTab} onValueChange={setMainTab} className="w-full">{nav()}
    <header className="border-b border-white/65 bg-[#F8FBFC]/68 backdrop-blur-xl"><div className="mx-auto flex max-w-[1180px] items-center justify-between gap-4 px-5 py-5 md:px-8 md:py-6"><div><div className="flex items-center gap-2 text-sm font-semibold tracking-[.1em] text-[#657985]"><GemStone color="#7383A2" secondaryColor="#4F8C89" size={23}/>마음의 보석함</div><h1 className="mt-1.5 text-2xl font-bold tracking-[-.04em] text-[#35434A] md:text-3xl">오늘의 마음은 어떤 빛인가요?</h1></div><div className="flex shrink-0 items-center gap-2 sm:gap-3"><AccountButton user={user} ready={authReady} busy={authBusy} onSignIn={login} onSignOut={logout}/><Dialog><DialogTrigger asChild><Button variant="outline" className="rounded-full border-white/90 bg-white/70 px-3 text-[#5F7080] shadow-sm sm:px-4"><HelpCircle className="size-4"/><span className="hidden sm:inline">사용법</span></Button></DialogTrigger><DialogContent className="max-h-[88vh] max-w-lg overflow-y-auto rounded-[28px] border-white/90 bg-[#F9FCFD] p-0"><div className="rounded-t-[28px] bg-[linear-gradient(135deg,#E7F1F3,#ECEAF4)] px-6 py-7"><GemStone color="#7A87A9" secondaryColor="#77ADB2" size={52}/><DialogHeader className="mt-3 text-left"><DialogTitle className="text-2xl text-[#3F4D54]">마음을 보석으로 간직하는 법</DialogTitle><DialogDescription className="mt-2 leading-6 text-[#6B797F]">기록하고, 색으로 알아차리고, 천천히 돌아보는 세 단계예요.</DialogDescription></DialogHeader></div><ol className="space-y-5 px-6 py-6">{[{n:"1",title:"날짜를 골라요",text:"달력에서 오늘이나 지난 날짜를 선택해요. 기록을 남긴 날은 감정 색과 작은 보석으로 표시되고, 미래 날짜는 선택할 수 없어요."},{n:"2",title:"마음과 이야기를 담아요",text:"지금과 가장 닮은 감정 보석 하나를 고르고 100자 이내로 짧게 적어요. 저장된 날짜를 다시 열면 감정과 메모를 수정하거나 삭제할 수 있어요."},{n:"3",title:"마음의 흐름을 돌아봐요",text:"보석함에서 주간·월간 보석과 감정별 횟수를 확인해요. 감정 카드를 누르면 아래 이야기 목록도 같은 감정으로 바로 걸러져요."}].map((step)=><li key={step.n} className="flex gap-3"><span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#64798A] text-sm font-bold text-white">{step.n}</span><span><strong className="block text-[#435159]">{step.title}</strong><span className="mt-1 block text-sm leading-6 text-[#718087]">{step.text}</span></span></li>)}</ol><div className="mx-6 mb-3 rounded-2xl border border-[#D6E3E7] bg-white/72 px-4 py-3 text-sm leading-6 text-[#65757D]"><strong className="text-[#465A63]">8가지 마음빛은 이렇게 놓였어요</strong><p className="mt-1">Russell의 감정 원형 모형에서 착안해, 마음이 얼마나 <b>쾌–불쾌</b>한지와 에너지가 얼마나 <b>높고–낮은지</b>를 함께 살펴보도록 배치했어요. 심리 진단이 아니라 내 마음을 더 섬세하게 알아차리기 위한 기준이에요.</p></div><div className="mx-6 mb-6 grid gap-2 rounded-2xl bg-[#EAF1F3] px-4 py-3 text-sm leading-6 text-[#65757D]"><p><strong className="text-[#465A63]">색을 읽는 작은 팁</strong><br/>밝은 색에서 차분하고 짙은 색으로 이어지는 스펙트럼을 보면 마음의 변화를 더 쉽게 알아차릴 수 있어요.</p><p className="border-t border-white/70 pt-2">로그인 전 기록은 이 브라우저에 안전하게 남아 있어요. 계정 저장 연결은 다음 단계에서 진행해요.</p></div></DialogContent></Dialog><GemStone color="#7383A2" secondaryColor="#4F8C89" size={48} className="gem-float hidden md:block"/></div></div></header>
      <TabsContent value="record" className="mx-auto w-full min-w-0 max-w-[1180px] px-4 pt-5 md:px-8 md:pt-6"><div className="grid min-w-0 items-start gap-5 lg:grid-cols-[minmax(0,1.08fr)_minmax(0,.92fr)]">
        <section className="pearl-card min-w-0 overflow-hidden rounded-[30px]"><div className="border-b border-[#EEE8EB] px-5 py-4 md:px-7"><p className="text-sm font-semibold text-[#857A86]">마음이 머문 날들</p><h2 className="mt-1 text-xl font-bold text-[#4A434C]">마음빛을 남길 날짜를 골라보세요</h2></div>
          <div className="relative overflow-hidden bg-[radial-gradient(circle_at_14%_12%,rgba(255,255,255,.9),transparent_28%),linear-gradient(145deg,rgba(232,241,244,.64),rgba(242,240,247,.76))]"><div className="pointer-events-none absolute -left-12 top-24 size-32 rounded-full bg-[#A9CED2]/20 blur-3xl"/><div className="pointer-events-none absolute -right-10 bottom-12 size-36 rounded-full bg-[#B5A4C8]/18 blur-3xl"/><Calendar mode="single" selected={fromDateKey(selectedDate)} onSelect={(date)=>date&&setSelectedDate(toDateKey(date))} month={calendarMonth} onMonthChange={setCalendarMonth} disabled={{after:today}} weekStartsOn={1} formatters={{formatCaption:(d)=>`${d.getFullYear()}년 ${d.getMonth()+1}월`,formatWeekdayName:(d)=>WEEKDAYS[d.getDay()]}} components={{DayButton:(props)=><MoodDayButton {...props} entriesByDate={byDate}/>}} className="relative z-10 w-full bg-transparent p-4 [--cell-size:clamp(2.65rem,12vw,4.65rem)] md:p-6" classNames={{root:"w-full",month:"w-full space-y-4",nav:"absolute right-0 top-0 flex items-center gap-1",month_caption:"flex h-(--cell-size) w-full items-center justify-start px-0",month_grid:"w-full border-separate border-spacing-1",caption_label:"text-lg font-bold text-[#5E5363] md:text-xl",weekdays:"flex w-full",weekday:"flex h-10 flex-1 items-center justify-center text-sm font-semibold text-[#7F8E94]",week:"mt-1 flex w-full gap-1",day:"relative aspect-square h-full w-full p-0 text-center",today:"rounded-[17px] text-[#536B78]",selected:"rounded-[17px]"}}/><div className="relative z-10 mx-4 mb-4 flex items-center justify-between rounded-2xl border border-white/80 bg-white/58 px-4 py-3 text-sm text-[#65777F] shadow-[0_8px_24px_rgba(65,87,96,.07)] md:mx-6 md:mb-6"><span className="font-semibold">이달의 보석 트레이</span><span className="font-bold text-[#50636D]">{calendarMonthCount}개의 마음빛</span></div></div>
        </section>
        <section className="pearl-card min-w-0 rounded-[30px] p-5 md:p-7 lg:sticky lg:top-5"><div className="mb-6 flex items-start justify-between gap-4"><div className="min-w-0"><p className="text-sm font-semibold text-[#8A7E8B]">{selectedDate===todayKey?"오늘":"선택한 날"}</p><h2 className="mt-1 text-xl font-bold text-[#4A434C]">{formatDate(selectedDate)}</h2></div>{selectedEntry&&<div className="flex shrink-0 items-center gap-2 rounded-full bg-[#F2EDF4] px-3 py-1.5 text-sm font-semibold text-[#6F6078]"><GemStone color={EMOTION_MAP[selectedEntry.emotion].color} expression={selectedEntry.emotion} size={22}/>간직한 마음</div>}</div>
          <fieldset><div className="mb-3 flex items-end justify-between gap-3"><legend className="font-bold text-[#45545B]">오늘 마음과 가장 닮은 보석을 골라주세요</legend><span className="shrink-0 text-[10px] font-bold tracking-[.12em] text-[#819197]">마음빛 지도</span></div><div className="grid grid-cols-[2.7rem_repeat(4,minmax(0,1fr))] gap-1.5" aria-label="쾌도와 에너지 수준에 따른 감정 선택">{MOOD_MAP_ROWS.map((row,rowIndex)=><div key={rowIndex} className="contents"><span className="flex items-center justify-center text-center text-[10px] font-semibold leading-3 text-[#839198]">{rowIndex===0?<>높은<br/>에너지</>:<>낮은<br/>에너지</>}</span>{row.map((value)=>{const item=EMOTION_MAP[value],active=emotion===value;return <button key={value} type="button" aria-pressed={active} aria-label={`${item.label}, ${item.gem}, ${item.categoryLabel}`} onClick={()=>{setEmotion(value);setError("");}} className={cn("flex min-h-[84px] flex-col items-center justify-center rounded-2xl border px-1 py-2 text-center transition focus-visible:ring-4 focus-visible:ring-[#718DA0]/20",active?"-translate-y-0.5 shadow-[0_9px_24px_rgba(59,82,92,.14)]":"border-white/90 bg-white/58 hover:-translate-y-0.5 hover:bg-white/85")} style={active?{backgroundColor:item.softColor,borderColor:item.color}:undefined}><GemStone color={item.color} expression={item.value} size={44}/><span className="mt-1 text-xs font-bold text-[#45535A]">{item.label}</span><span className="mt-0.5 hidden text-[9px] text-[#7A878D] sm:block">{item.gem}</span></button>})}</div>)}</div><div className="ml-[3.3rem] mt-2 flex items-center justify-between text-[10px] font-semibold text-[#7D8B91]"><span>← 불쾌한 마음</span><span>쾌한 마음 →</span></div></fieldset>
          <div className="mt-6"><div className="mb-2 flex items-center justify-between gap-3"><label htmlFor="mood-note" className="font-bold text-[#514A53]">보석에 담긴 이야기</label><div className="flex items-center gap-2"><Button type="button" variant="outline" size="sm" onClick={recording?stopRecording:startRecording} disabled={dataBusy} aria-pressed={recording} className={cn("h-8 rounded-full border-white/90 bg-white/75 px-3 text-xs font-bold shadow-sm",recording?"border-[#D7A0A8] bg-[#F8E8EB] text-[#A94756]":"text-[#5F7080]")}>{recording?<><Square className="size-3 fill-current"/>멈추기</>:<><Mic className="size-3.5"/>말로 쓰기</>}</Button><span className="text-sm text-[#8A8188]">{note.length}/100</span></div></div><Textarea id="mood-note" value={note} maxLength={100} onChange={(e)=>{setNote(e.target.value);setVoiceMessage("");setError("");}} placeholder="오늘의 마음을 짧은 이야기로 남겨보세요." aria-invalid={Boolean(error)} className="min-h-32 resize-none rounded-2xl border-[#DED6DC] bg-white/65 p-4 leading-7 focus-visible:border-[#9A82B5]"/>{voiceMessage&&<p aria-live="polite" className={cn("mt-2 inline-flex items-center gap-1.5 text-sm font-medium",recording?"text-[#A94756]":"text-[#617984]")}>{recording?<span className="size-2 animate-pulse rounded-full bg-[#C75564]"/>:<Mic className="size-4"/>}{voiceMessage}</p>}<p aria-live="polite" className="mt-1 min-h-5 text-sm font-medium text-[#B2535B]">{error}</p></div>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row-reverse"><Button size="lg" onClick={save} disabled={!hydrated||dataBusy||recording||!emotion||!note.trim()} className="h-12 flex-1 rounded-xl bg-[#6F6078] text-white hover:bg-[#5E5067]"><Save/>{dataBusy?"보석함에 담는 중...":selectedEntry?"마음빛 다시 담기":"오늘의 마음빛 간직하기"}</Button>{selectedEntry&&<AlertDialog><AlertDialogTrigger asChild><Button variant="outline" size="lg" disabled={dataBusy||recording} className="h-12 rounded-xl border-[#E5BFC3] bg-white/70 text-[#A54D55] sm:w-32"><Trash2/>삭제</Button></AlertDialogTrigger><AlertDialogContent className="rounded-2xl bg-[#FFFCFA]"><AlertDialogHeader><AlertDialogTitle>이날의 기록을 삭제할까요?</AlertDialogTitle><AlertDialogDescription>{formatDate(selectedDate)}의 감정과 메모는 삭제 후 다시 복구할 수 없어요.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>취소</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={remove}>삭제</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>}</div>
        </section>
      </div></TabsContent>

      <TabsContent value="jewels" className="mx-auto w-full min-w-0 max-w-[1180px] px-4 pt-5 md:px-8 md:pt-6"><section className="pearl-card w-full min-w-0 max-w-full overflow-hidden rounded-[30px] p-5 md:p-8">
        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between"><div><p className="text-sm font-semibold text-[#8A7E8B]">차곡차곡 모인 마음의 빛</p><h2 className="mt-1 text-2xl font-bold text-[#4A434C] md:text-3xl">나의 보석함</h2></div><div className="grid grid-cols-2 rounded-xl bg-[#F0EAEE] p-1">{(["week","month"] as const).map((value)=><button key={value} onClick={()=>{setMode(value);setAnchor(today);setFilter("all");}} aria-pressed={mode===value} className={cn("rounded-lg px-5 py-2.5 text-sm font-bold",mode===value?"bg-white text-[#6F6078] shadow-sm":"text-[#837882]")}>{value==="week"?"주간":"월간"}</button>)}</div></div>
        <div className="mt-6 flex items-center justify-between rounded-2xl border border-white/80 bg-white/55 px-3 py-2"><button onClick={()=>movePeriod(-1)} aria-label="이전 기간" className="rounded-xl p-2.5 text-[#6F6078]"><ChevronLeft/></button><p className="text-center font-bold text-[#514A53] md:text-lg">{periodLabel(mode,bounds.start,bounds.end)}</p><button onClick={()=>movePeriod(1)} disabled={!canNext} aria-label="다음 기간" className="rounded-xl p-2.5 text-[#6F6078] disabled:opacity-25"><ChevronRight/></button></div>
        <div className="mt-5 grid w-full min-w-0 max-w-full gap-5 lg:h-[380px] lg:grid-cols-[minmax(0,.8fr)_minmax(0,1.2fr)]"><div className="gem-summary flex min-h-[360px] min-w-0 max-w-full flex-col items-center justify-center overflow-hidden rounded-[28px] border border-white/80 p-7 text-center lg:h-[380px] lg:min-h-0"><p className="text-sm font-semibold text-[#687981]">{mode==="week"?"이번 주의 보석":"이달의 보석"}</p><GemStone color={periodColor} secondaryColor={secondary?.color??leaders[0]?.color} expression={dominant?.value} size={150} label={periodEntries.length?(dominant?`${dominant.label}의 빛이 가장 많이 담긴 보석`:`${leaders.map((item)=>item.label).join("·")}의 빛이 고르게 담긴 보석`):"아직 색이 담기지 않은 보석"} className="gem-float my-6"/>{periodEntries.length?<>{dominant?<><p className="text-xl font-bold text-[#3F4D54] lg:flex lg:min-h-14 lg:items-center lg:justify-center">{dominant.label}의 빛이 가장 많이 머물렀어요</p><p className="mt-2 text-sm leading-6 text-[#6F7D83] lg:min-h-12">{periodEntries.length}일 중 {counts[dominant.value]}일의 기록에서 가장 자주 나타났어요.</p></>:<><p className="text-xl font-bold text-[#3F4D54] lg:flex lg:min-h-14 lg:items-center lg:justify-center">{leaders.map((item)=>item.label).join("·")}이 고르게 머물렀어요</p><p className="mt-2 text-sm leading-6 text-[#6F7D83] lg:min-h-12">각각 {counts[leaders[0].value]}번씩 기록되어, 어느 한 마음빛이 대표하지 않아요.</p></>}</>:<><p className="text-xl font-bold text-[#3F4D54] lg:flex lg:min-h-14 lg:items-center lg:justify-center">아직 색이 담기지 않았어요</p><p className="mt-2 text-sm leading-6 text-[#6F7D83] lg:min-h-12">마음빛을 조금 더 모으면 이 기간의 보석을 보여드릴게요.</p></>}</div>
          <div className="grid min-w-0 max-w-full grid-cols-2 gap-3 sm:grid-cols-4 lg:h-[380px] lg:grid-rows-[76px_repeat(2,minmax(0,1fr))]"><button aria-pressed={filter==="all"} onClick={()=>setFilter("all")} className={cn("group col-span-2 min-w-0 overflow-hidden rounded-2xl border p-4 text-left transition sm:col-span-4",filter==="all"?"border-[#91AAB4] bg-[linear-gradient(120deg,rgba(230,241,243,.96),rgba(238,237,247,.9))] shadow-[0_10px_28px_rgba(67,91,102,.12)]":"border-white/90 bg-white/65 hover:bg-white/90")}><div className="flex min-w-0 items-center justify-between gap-4"><div className="min-w-0"><span className="text-[11px] font-bold tracking-[.16em] text-[#758891]">ALL MOODS</span><p className="mt-1 truncate text-lg font-bold text-[#3E4D55]">모든 마음빛</p></div><span className={cn("grid size-12 shrink-0 place-items-center rounded-2xl text-2xl font-bold",filter==="all"?"bg-white/80 text-[#526976] shadow-sm":"bg-[#EAF0F2] text-[#687981]")}>{periodEntries.length}</span></div></button>{EMOTIONS.map((item)=>{const active=filter===item.value;return <button key={item.value} aria-pressed={active} onClick={()=>setFilter(item.value)} className={cn("min-h-28 min-w-0 overflow-hidden rounded-2xl border bg-white/68 p-3.5 text-left transition lg:min-h-0",active?"scale-[1.01] shadow-[0_8px_22px_rgba(67,91,102,.12)]":"border-[#DCE6E9] hover:bg-white")} style={active?{backgroundColor:item.softColor,borderColor:item.color}:undefined}><div className="flex h-full min-w-0 flex-col justify-between"><span className="flex min-w-0 items-center gap-2"><GemStone color={item.color} expression={item.value} size={42}/><span className="truncate font-bold text-[#45535A]">{item.label}</span></span><span className="text-right text-2xl font-bold text-[#526168]">{counts[item.value]}</span></div></button>})}</div>
        </div>
        <EnergyAnalysis entries={periodEntries} counts={counts}/>
      </section>
      <section className="pearl-card mt-5 w-full min-w-0 max-w-full overflow-hidden rounded-[30px] p-5 md:p-8"><div className="mb-5 flex items-center justify-between"><div className="min-w-0"><p className="text-sm font-semibold text-[#8A7E8B]">하루하루 담아둔 마음</p><h2 className="mt-1 text-xl font-bold text-[#4A434C]">보석에 담긴 이야기</h2></div><span className="shrink-0 rounded-full bg-white/75 px-3 py-1.5 text-sm font-semibold text-[#786C78]">{visible.length}개</span></div>{visible.length?<ul className="grid min-w-0 gap-3 md:grid-cols-2">{visible.map((entry)=>{const item=EMOTION_MAP[entry.emotion];return <li key={entry.date} className="min-w-0 overflow-hidden rounded-2xl border border-[#EAE5E8] bg-white/58 p-4 md:p-5"><div className="flex min-w-0 items-center justify-between gap-3"><span className="inline-flex min-w-0 items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-bold" style={{backgroundColor:item.softColor,borderColor:`${item.color}55`}}><GemStone color={item.color} expression={item.value} size={24}/><span className="truncate">{item.label}</span></span><time className="shrink-0 text-sm text-[#837A82]">{formatDate(entry.date)}</time></div><p className="mt-3 break-words leading-7 text-[#4C474C]">{entry.note}</p></li>})}</ul>:<div className="rounded-2xl border border-dashed border-[#D8CFD6] bg-white/45 px-6 py-12 text-center"><CalendarDays className="mx-auto size-8 text-[#9A8E99]"/><p className="mt-3 font-bold text-[#5D535F]">아직 간직한 마음이 없어요</p><p className="mt-1 text-sm text-[#837A82]">오늘의 마음부터 천천히 담아보세요.</p></div>}</section>
      </TabsContent>

      <TabsContent value="account" className="mx-auto max-w-[720px] px-4 pt-5 md:px-8 md:pt-8">
        <section className="pearl-card rounded-[30px] p-6 text-center md:p-10">
          {user?<><p className="text-sm font-semibold tracking-[.12em] text-[#7A8990]">CONNECTED ACCOUNT</p><h2 className="mt-3 text-2xl font-bold tracking-[-.03em] text-[#3F4D54] md:text-3xl">{user.displayName?.trim()||"내 계정"}님의 보석함</h2>{user.email&&<p className="mt-2 text-sm text-[#718087]">{user.email}</p>}<p className="mx-auto mt-6 max-w-md leading-7 text-[#65757D]">이제 감정 기록이 이 Google 계정의 보석함에 저장돼요. 다른 기기에서도 같은 계정으로 로그인하면 기록을 이어서 볼 수 있습니다.</p><p className="mt-3 text-sm font-semibold text-[#6D8388]">{dataBusy?"계정 보석함을 동기화하는 중이에요.":`${entries.length}개의 마음빛이 계정에 연결되어 있어요.`}</p><Button type="button" variant="outline" size="lg" onClick={logout} disabled={!authReady||authBusy||dataBusy} className="mt-7 h-12 min-w-40 rounded-xl border-[#CCDADD] bg-white/70 text-[#536771] hover:bg-white">{authBusy?"연결 해제 중...":"로그아웃"}</Button></>:<><p className="text-sm font-semibold tracking-[.12em] text-[#7A8990]">MY JEWEL BOX</p><h2 className="mt-3 text-2xl font-bold tracking-[-.03em] text-[#3F4D54] md:text-3xl">어디서든 같은 보석함을 열어보세요</h2><p className="mx-auto mt-5 max-w-md leading-7 text-[#65757D]">Google 계정으로 로그인하면 기기를 바꿔도 나의 감정 기록을 이어서 볼 수 있어요. 로그인 전 기록은 가져올지 직접 선택할 수 있습니다.</p><Button type="button" size="lg" onClick={login} disabled={!authReady||authBusy} className="mt-7 h-12 min-w-52 rounded-xl bg-[#6F6078] text-white hover:bg-[#5E5067]">{!authReady?"로그인 준비 중...":authBusy?"로그인 연결 중...":"Google 계정으로 로그인"}</Button></>}
        </section>
      </TabsContent>
    </Tabs>
  </main>;
}
