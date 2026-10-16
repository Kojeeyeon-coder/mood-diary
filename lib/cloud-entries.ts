import { collection, deleteDoc, doc, getDocs, onSnapshot, orderBy, query, runTransaction, serverTimestamp, Timestamp, writeBatch } from "firebase/firestore";
import { getFirebaseDb } from "@/lib/firebase";

export type CloudDiaryEntry = {
  date: string;
  emotion: string;
  note: string;
  createdAt: string;
  updatedAt: string;
};

function entriesCollection(uid: string) {
  return collection(getFirebaseDb(), "users", uid, "entries");
}

function toIso(value: unknown) {
  return value instanceof Timestamp ? value.toDate().toISOString() : new Date(0).toISOString();
}

function fromSnapshot(id: string, data: Record<string, unknown>): CloudDiaryEntry {
  return {
    date: typeof data.date === "string" ? data.date : id,
    emotion: typeof data.emotion === "string" ? data.emotion : "",
    note: typeof data.note === "string" ? data.note : "",
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
  };
}

export function subscribeCloudEntries(uid: string, onEntries: (entries: CloudDiaryEntry[]) => void, onError: (error: Error) => void) {
  return onSnapshot(query(entriesCollection(uid), orderBy("date", "desc")), snapshot => {
    onEntries(snapshot.docs.map(item => fromSnapshot(item.id, item.data())));
  }, error => onError(error));
}

export async function listCloudEntries(uid: string) {
  const snapshot = await getDocs(query(entriesCollection(uid), orderBy("date", "desc")));
  return snapshot.docs.map(item => fromSnapshot(item.id, item.data()));
}

export async function upsertCloudEntry(uid: string, entry: CloudDiaryEntry) {
  const reference = doc(getFirebaseDb(), "users", uid, "entries", entry.date);
  await runTransaction(getFirebaseDb(), async transaction => {
    const current = await transaction.get(reference);
    const createdAt = current.exists() && current.data().createdAt instanceof Timestamp ? current.data().createdAt : serverTimestamp();
    transaction.set(reference, {
      date: entry.date,
      emotion: entry.emotion,
      note: entry.note.trim(),
      createdAt,
      updatedAt: serverTimestamp(),
      schemaVersion: 1,
    });
  });
}

export async function deleteCloudEntry(uid: string, date: string) {
  await deleteDoc(doc(getFirebaseDb(), "users", uid, "entries", date));
}

function safeTimestamp(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? Timestamp.now() : Timestamp.fromDate(date);
}

export async function importCloudEntries(uid: string, localEntries: CloudDiaryEntry[]) {
  const existing = new Set((await getDocs(entriesCollection(uid))).docs.map(item => item.id));
  const missing = localEntries.filter(entry => !existing.has(entry.date));
  for (let offset = 0; offset < missing.length; offset += 450) {
    const batch = writeBatch(getFirebaseDb());
    for (const entry of missing.slice(offset, offset + 450)) {
      batch.set(doc(getFirebaseDb(), "users", uid, "entries", entry.date), {
        date: entry.date,
        emotion: entry.emotion,
        note: entry.note.trim(),
        createdAt: safeTimestamp(entry.createdAt),
        updatedAt: safeTimestamp(entry.updatedAt),
        schemaVersion: 1,
      });
    }
    await batch.commit();
  }
  return { imported: missing.length, skipped: localEntries.length - missing.length };
}
