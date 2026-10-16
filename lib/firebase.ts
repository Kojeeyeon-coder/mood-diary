import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDegxhhqyXvRI0GvKBEvK_3AU_faJcrAIY",
  authDomain: "mood-jewel-diary.firebaseapp.com",
  projectId: "mood-jewel-diary",
  storageBucket: "mood-jewel-diary.firebasestorage.app",
  messagingSenderId: "42920192404",
  appId: "1:42920192404:web:65f362906e09bfd5814781",
};

function getFirebaseApp() { return getApps().length ? getApp() : initializeApp(firebaseConfig); }

export function getFirebaseAuth() { return getAuth(getFirebaseApp()); }
export function getFirebaseDb() { return getFirestore(getFirebaseApp()); }
export function createGoogleProvider() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  return provider;
}
