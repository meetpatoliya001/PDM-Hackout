import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyC4-uq1Z0_hlA2cz9Di18a_TwJeU5SN-fk",
  authDomain: "mangrove-watch-1b914.firebaseapp.com",
  projectId: "mangrove-watch-1b914",
  storageBucket: "mangrove-watch-1b914.firebasestorage.app",
  messagingSenderId: "250875263201",
  appId: "1:250875263201:web:24b177d2a7da8f43099fa0",
  measurementId: "G-0KQKDSM17N"
};


const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const storage = getStorage(app);
export const auth = getAuth(app);