/**
 * ============================================================
 * SMART STUDY ROUTINE & LEARNING TRACKER
 * Production-Ready Web Application — script.js
 * ============================================================
 * Architecture : Feature-based modules, clean separation
 * Storage      : IndexedDB (offline-first) + localStorage cache
 * State        : Reactive store pattern (pub/sub)
 * Sync         : Firebase Firestore + Storage (optional)
 * Notifications: Web Notifications API + Service Worker
 * Charts       : Chart.js
 * Export       : jsPDF + html2canvas
 * ============================================================
 */

'use strict';

/* ============================================================
   SECTION 1 — CONFIGURATION
   ============================================================ */

const APP_CONFIG = {
  name: 'SmartStudy',
  version: '1.0.0',
  db: {
    name: 'SmartStudyDB',
    version: 1,
    stores: {
      users: 'users',
      routines: 'routines',
      studyLogs: 'studyLogs',
      notes: 'notes',
      tags: 'tags',
      points: 'points',
      streaks: 'streaks',
      notifications: 'notifications',
      syncQueue: 'syncQueue',
    },
  },
  firebase: {
    enabled: false, // Set true + fill credentials to enable cloud sync
    apiKey: '',
    authDomain: '',
    projectId: '',
    storageBucket: '',
    messagingSenderId: '',
    appId: '',
  },
  gamification: {
    pointsPerSession: 10,
    streakBonusMultiplier: 1.5,
    levels: [
      { level: 1, name: 'Beginner', minPoints: 0, icon: '🌱' },
      { level: 2, name: 'Consistent Learner', minPoints: 100, icon: '📚' },
      { level: 3, name: 'Advanced', minPoints: 500, icon: '🎯' },
      { level: 4, name: 'Master Learner', minPoints: 1500, icon: '🏆' },
    ],
  },
  notifications: {
    dailyReminderHour: 9,
    revisionIntervals: [1, 3, 7], // days
  },
  subjectColors: [
    '#E74C3C', '#3498DB', '#2ECC71', '#F39C12',
    '#9B59B6', '#1ABC9C', '#E67E22', '#34495E',
    '#16A085', '#8E44AD', '#2980B9', '#27AE60',
  ],
  motivationalMessages: [
    'Every expert was once a beginner. Keep going! 🌟',
    'Your future self is thanking you right now. 💪',
    'Consistency beats intensity every time. 📈',
    'Small steps every day lead to big results. 🚀',
    'You\'re building habits that last a lifetime. 🔥',
    'Progress, not perfection. Keep learning! ✨',
    'The secret of getting ahead is getting started. 🎯',
    'Success is the sum of small efforts repeated. 💡',
  ],
};

/* ============================================================
   SECTION 2 — UTILITY HELPERS
   ============================================================ */

const Utils = (() => {
  /**
   * Generate a unique UUID v4
   */
  function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  /**
   * Format a Date to ISO date string YYYY-MM-DD
   */
  function toDateString(date = new Date()) {
    return date.toISOString().split('T')[0];
  }

  /**
   * Format minutes to human-readable duration
   */
  function formatDuration(minutes) {
    if (minutes < 60) return `${minutes}m`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }

  /**
   * Debounce function
   */
  function debounce(fn, delay = 300) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  }

  /**
   * Deep clone an object
   */
  function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  /**
   * Get start of week (Monday) for a given date
   */
  function startOfWeek(date = new Date()) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  /**
   * Get array of 7 date strings for current week
   */
  function getWeekDates(refDate = new Date()) {
    const start = startOfWeek(refDate);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      return toDateString(d);
    });
  }

  /**
   * Highlight substring matches in text
   */
  function highlightText(text, query) {
    if (!query) return text;
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escaped})`, 'gi');
    return text.replace(regex, '<mark>$1</mark>');
  }

  /**
   * Convert a File/Blob to base64 string
   */
  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  /**
   * Sanitise HTML to prevent XSS
   */
  function sanitizeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /**
   * Format a timestamp to locale string
   */
  function formatDateTime(timestamp) {
    return new Date(timestamp).toLocaleString(navigator.language, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  /**
   * Throttle function
   */
  function throttle(fn, limit = 200) {
    let inThrottle;
    return (...args) => {
      if (!inThrottle) {
        fn(...args);
        inThrottle = true;
        setTimeout(() => (inThrottle = false), limit);
      }
    };
  }

  /**
   * Get day-of-week labels
   */
  const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  /**
   * Parse HH:MM string to minutes since midnight
   */
  function timeToMinutes(timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
  }

  /**
   * Check if two time ranges overlap
   */
  function timesOverlap(start1, end1, start2, end2) {
    const s1 = timeToMinutes(start1);
    const e1 = timeToMinutes(end1);
    const s2 = timeToMinutes(start2);
    const e2 = timeToMinutes(end2);
    return s1 < e2 && e1 > s2;
  }

  return {
    uuid, toDateString, formatDuration, debounce, deepClone,
    startOfWeek, getWeekDates, highlightText, fileToBase64,
    sanitizeHTML, formatDateTime, throttle, DAY_LABELS,
    timeToMinutes, timesOverlap,
  };
})();

/* ============================================================
   SECTION 3 — DATA MODELS
   ============================================================ */

const Models = (() => {
  /**
   * User model
   */
  function createUser(overrides = {}) {
    return {
      id: Utils.uuid(),
      name: '',
      email: '',
      avatar: null,
      authProvider: 'anonymous', // 'anonymous' | 'google'
      firebaseUid: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...overrides,
    };
  }

  /**
   * Routine model — a single study block in the weekly timetable
   */
  function createRoutine(overrides = {}) {
    return {
      id: Utils.uuid(),
      userId: null,
      subject: '',
      topic: '',
      dayOfWeek: 1,          // 1=Mon … 7=Sun
      startTime: '09:00',    // HH:MM
      endTime: '10:00',
      color: APP_CONFIG.subjectColors[0],
      tags: [],
      isActive: true,
      notificationEnabled: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      syncedAt: null,
      ...overrides,
    };
  }

  /**
   * StudyLog model — a completed study session entry
   */
  function createStudyLog(overrides = {}) {
    return {
      id: Utils.uuid(),
      userId: null,
      subject: '',
      topic: '',
      durationMinutes: 0,
      notes: '',
      imageIds: [],          // references to Note ids with images
      tags: [],
      date: Utils.toDateString(),
      timestamp: Date.now(),
      pointsEarned: 0,
      routineId: null,       // linked routine if any
      createdAt: Date.now(),
      updatedAt: Date.now(),
      syncedAt: null,
      ...overrides,
    };
  }

  /**
   * Note model — rich note with optional image
   */
  function createNote(overrides = {}) {
    return {
      id: Utils.uuid(),
      userId: null,
      studyLogId: null,
      title: '',
      content: '',
      imageBase64: null,     // base64 data URI
      imageUrl: null,        // Firebase Storage URL
      ocrText: '',           // extracted text from image
      tags: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      syncedAt: null,
      ...overrides,
    };
  }

  /**
   * Tag model
   */
  function createTag(overrides = {}) {
    return {
      id: Utils.uuid(),
      userId: null,
      name: '',
      color: '#3498DB',
      createdAt: Date.now(),
      ...overrides,
    };
  }

  /**
   * Points model — cumulative gamification state
   */
  function createPoints(overrides = {}) {
    return {
      id: Utils.uuid(),
      userId: null,
      total: 0,
      level: 1,
      levelName: 'Beginner',
      history: [],           // [{ sessionId, points, timestamp }]
      updatedAt: Date.now(),
      ...overrides,
    };
  }

  /**
   * Streak model
   */
  function createStreak(overrides = {}) {
    return {
      id: Utils.uuid(),
      userId: null,
      current: 0,
      longest: 0,
      lastStudyDate: null,
      updatedAt: Date.now(),
      ...overrides,
    };
  }

  /**
   * NotificationSchedule model
   */
  function createNotificationSchedule(overrides = {}) {
    return {
      id: Utils.uuid(),
      userId: null,
      type: 'daily',         // 'daily' | 'routine' | 'revision'
      studyLogId: null,
      routineId: null,
      scheduledFor: null,    // ISO timestamp
      sent: false,
      createdAt: Date.now(),
      ...overrides,
    };
  }

  /**
   * JSON serializers — strip internal fields not needed for export
   */
  function toJSON(model) {
    return JSON.parse(JSON.stringify(model));
  }

  return {
    createUser, createRoutine, createStudyLog,
    createNote, createTag, createPoints, createStreak,
    createNotificationSchedule, toJSON,
  };
})();

/* ============================================================
   SECTION 4 — INDEXED DB (LOCAL DATABASE)
   ============================================================ */

const Database = (() => {
  let _db = null;

  /**
   * Open the IndexedDB, create object stores on upgrade
   */
  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(APP_CONFIG.db.name, APP_CONFIG.db.version);

      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        const stores = APP_CONFIG.db.stores;

        // Helper to create a store if it doesn't exist
        const ensureStore = (name, keyPath, indexes = []) => {
          if (!db.objectStoreNames.contains(name)) {
            const store = db.createObjectStore(name, { keyPath });
            indexes.forEach(({ name: idxName, key, opts }) => {
              store.createIndex(idxName, key, opts || {});
            });
          }
        };

        ensureStore(stores.users, 'id');
        ensureStore(stores.routines, 'id', [
          { name: 'userId', key: 'userId' },
          { name: 'dayOfWeek', key: 'dayOfWeek' },
        ]);
        ensureStore(stores.studyLogs, 'id', [
          { name: 'userId', key: 'userId' },
          { name: 'date', key: 'date' },
          { name: 'subject', key: 'subject' },
        ]);
        ensureStore(stores.notes, 'id', [
          { name: 'studyLogId', key: 'studyLogId' },
          { name: 'userId', key: 'userId' },
        ]);
        ensureStore(stores.tags, 'id', [
          { name: 'userId', key: 'userId' },
        ]);
        ensureStore(stores.points, 'id', [
          { name: 'userId', key: 'userId' },
        ]);
        ensureStore(stores.streaks, 'id', [
          { name: 'userId', key: 'userId' },
        ]);
        ensureStore(stores.notifications, 'id', [
          { name: 'userId', key: 'userId' },
          { name: 'sent', key: 'sent' },
        ]);
        ensureStore(stores.syncQueue, 'id', [
          { name: 'action', key: 'action' },
        ]);
      };

      req.onsuccess = (e) => {
        _db = e.target.result;
        resolve(_db);
      };

      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Generic get-all from a store, optionally filtered by index
   */
  function getAll(storeName, indexName = null, indexValue = null) {
    return new Promise((resolve, reject) => {
      const tx = _db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = indexName
        ? store.index(indexName).getAll(indexValue)
        : store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Get a single record by primary key
   */
  function getById(storeName, id) {
    return new Promise((resolve, reject) => {
      const tx = _db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Put (insert or update) a record
   */
  function put(storeName, record) {
    return new Promise((resolve, reject) => {
      const tx = _db.transaction(storeName, 'readwrite');
      const req = tx.objectStore(storeName).put(record);
      req.onsuccess = () => resolve(record);
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Delete a record by primary key
   */
  function remove(storeName, id) {
    return new Promise((resolve, reject) => {
      const tx = _db.transaction(storeName, 'readwrite');
      const req = tx.objectStore(storeName).delete(id);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Put multiple records in one transaction
   */
  function putBatch(storeName, records) {
    return new Promise((resolve, reject) => {
      const tx = _db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      records.forEach((r) => store.put(r));
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Clear all records from a store
   */
  function clearStore(storeName) {
    return new Promise((resolve, reject) => {
      const tx = _db.transaction(storeName, 'readwrite');
      const req = tx.objectStore(storeName).clear();
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  return { open, getAll, getById, put, remove, putBatch, clearStore };
})();

/* ============================================================
   SECTION 5 — REACTIVE STORE (STATE MANAGEMENT)
   ============================================================ */

const Store = (() => {
  const _state = {
    currentUser: null,
    routines: [],
    studyLogs: [],
    notes: [],
    tags: [],
    points: null,
    streak: null,
    notifications: [],
    ui: {
      activePage: 'dashboard',
      activeModal: null,
      searchQuery: '',
      selectedDate: Utils.toDateString(),
      weekOffset: 0,        // 0 = current week
      isLoading: false,
      toast: null,
    },
  };

  const _listeners = new Map();

  /**
   * Subscribe to state changes
   * @param {string} key — top-level state key or '*' for all
   * @param {Function} callback
   * @returns {Function} unsubscribe
   */
  function subscribe(key, callback) {
    if (!_listeners.has(key)) _listeners.set(key, new Set());
    _listeners.get(key).add(callback);
    return () => _listeners.get(key).delete(callback);
  }

  /**
   * Notify all listeners for a given key
   */
  function _notify(key) {
    if (_listeners.has(key)) {
      _listeners.get(key).forEach((cb) => cb(_state[key]));
    }
    if (_listeners.has('*')) {
      _listeners.get('*').forEach((cb) => cb(_state));
    }
  }

  /**
   * Set top-level state key
   */
  function setState(key, value) {
    _state[key] = value;
    _notify(key);
  }

  /**
   * Merge partial update into a top-level object key
   */
  function mergeState(key, partial) {
    _state[key] = { ..._state[key], ...partial };
    _notify(key);
  }

  /**
   * Read current state snapshot
   */
  function getState(key) {
    return key ? _state[key] : _state;
  }

  /**
   * Push an item into an array state key
   */
  function pushItem(key, item) {
    _state[key] = [...(_state[key] || []), item];
    _notify(key);
  }

  /**
   * Update a specific item in an array state key by id
   */
  function updateItem(key, id, partial) {
    _state[key] = (_state[key] || []).map((item) =>
      item.id === id ? { ...item, ...partial, updatedAt: Date.now() } : item
    );
    _notify(key);
  }

  /**
   * Remove a specific item from an array state key by id
   */
  function removeItem(key, id) {
    _state[key] = (_state[key] || []).filter((item) => item.id !== id);
    _notify(key);
  }

  return {
    subscribe, setState, mergeState, getState,
    pushItem, updateItem, removeItem,
  };
})();

/* ============================================================
   SECTION 6 — GAMIFICATION SERVICE
   ============================================================ */

const GamificationService = (() => {
  /**
   * Calculate level from total points
   */
  function calculateLevel(totalPoints) {
    const levels = [...APP_CONFIG.gamification.levels].reverse();
    return levels.find((l) => totalPoints >= l.minPoints) || levels[levels.length - 1];
  }

  /**
   * Award points for a completed study session
   */
  async function awardSessionPoints(studyLogId, streakCount) {
    const userId = Store.getState('currentUser')?.id;
    if (!userId) return;

    let pointsRec = Store.getState('points');
    if (!pointsRec) {
      pointsRec = Models.createPoints({ userId });
    }

    const base = APP_CONFIG.gamification.pointsPerSession;
    const streakBonus = streakCount > 1
      ? Math.floor(base * (APP_CONFIG.gamification.streakBonusMultiplier - 1))
      : 0;
    const earned = base + streakBonus;

    const newTotal = pointsRec.total + earned;
    const levelInfo = calculateLevel(newTotal);

    const updated = {
      ...pointsRec,
      total: newTotal,
      level: levelInfo.level,
      levelName: levelInfo.name,
      history: [
        ...pointsRec.history,
        { studyLogId, points: earned, timestamp: Date.now() },
      ],
      updatedAt: Date.now(),
    };

    await Database.put(APP_CONFIG.db.stores.points, updated);
    Store.setState('points', updated);

    return { earned, total: newTotal, levelInfo, streakBonus };
  }

  /**
   * Update streak after a study session
   */
  async function updateStreak() {
    const userId = Store.getState('currentUser')?.id;
    if (!userId) return 0;

    let streakRec = Store.getState('streak');
    if (!streakRec) {
      streakRec = Models.createStreak({ userId });
    }

    const today = Utils.toDateString();
    const yesterday = Utils.toDateString(
      new Date(Date.now() - 86400000)
    );

    let current = streakRec.current;

    if (streakRec.lastStudyDate === today) {
      // Already counted today
    } else if (streakRec.lastStudyDate === yesterday) {
      current += 1;
    } else {
      current = 1; // Reset streak
    }

    const updated = {
      ...streakRec,
      current,
      longest: Math.max(streakRec.longest, current),
      lastStudyDate: today,
      updatedAt: Date.now(),
    };

    await Database.put(APP_CONFIG.db.stores.streaks, updated);
    Store.setState('streak', updated);

    return current;
  }

  /**
   * Get motivational message based on performance
   */
  function getMotivationalMessage(streak = 0) {
    const msgs = APP_CONFIG.motivationalMessages;
    const index = (streak + Math.floor(Math.random() * 3)) % msgs.length;
    return msgs[index];
  }

  return { calculateLevel, awardSessionPoints, updateStreak, getMotivationalMessage };
})();

/* ============================================================
   SECTION 7 — NOTIFICATION SERVICE
   ============================================================ */

const NotificationService = (() => {
  let _permission = 'default';

  /**
   * Request browser notification permission
   */
  async function requestPermission() {
    if (!('Notification' in window)) return false;
    _permission = await Notification.requestPermission();
    return _permission === 'granted';
  }

  /**
   * Show a browser notification
   */
  function show(title, options = {}) {
    if (_permission !== 'granted') return;
    const n = new Notification(title, {
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-72.png',
      ...options,
    });
    n.onclick = () => window.focus();
    return n;
  }

  /**
   * Schedule a daily reminder (checks once per minute)
   */
  function scheduleDailyReminder() {
    const check = () => {
      const now = new Date();
      const targetHour = APP_CONFIG.notifications.dailyReminderHour;
      if (now.getHours() === targetHour && now.getMinutes() === 0) {
        show('Time to Study! 📚', {
          body: GamificationService.getMotivationalMessage(
            Store.getState('streak')?.current || 0
          ),
          tag: 'daily-reminder',
        });
      }
    };
    setInterval(check, 60000);
  }

  /**
   * Schedule revision reminders for a study log entry
   */
  async function scheduleRevisionReminders(studyLog) {
    const userId = Store.getState('currentUser')?.id;
    if (!userId) return;

    const intervals = APP_CONFIG.notifications.revisionIntervals;
    const records = intervals.map((days) => {
      const scheduledFor = new Date(studyLog.timestamp);
      scheduledFor.setDate(scheduledFor.getDate() + days);

      return Models.createNotificationSchedule({
        userId,
        type: 'revision',
        studyLogId: studyLog.id,
        scheduledFor: scheduledFor.toISOString(),
        sent: false,
      });
    });

    for (const rec of records) {
      await Database.put(APP_CONFIG.db.stores.notifications, rec);
    }

    checkPendingNotifications();
  }

  /**
   * Check and fire any pending scheduled notifications
   */
  async function checkPendingNotifications() {
    const userId = Store.getState('currentUser')?.id;
    if (!userId) return;

    const all = await Database.getAll(
      APP_CONFIG.db.stores.notifications, 'userId', userId
    );
    const pending = all.filter(
      (n) => !n.sent && new Date(n.scheduledFor) <= new Date()
    );

    for (const n of pending) {
      if (n.type === 'revision') {
        const log = await Database.getById(APP_CONFIG.db.stores.studyLogs, n.studyLogId);
        if (log) {
          show(`Revision Time! 🔄`, {
            body: `Review: ${log.subject} — ${log.topic}`,
            tag: `revision-${n.id}`,
          });
        }
      }

      const updated = { ...n, sent: true };
      await Database.put(APP_CONFIG.db.stores.notifications, updated);
    }
  }

  return {
    requestPermission, show, scheduleDailyReminder,
    scheduleRevisionReminders, checkPendingNotifications,
  };
})();

/* ============================================================
   SECTION 8 — FIREBASE SYNC SERVICE (OPTIONAL)
   ============================================================ */

const FirebaseSyncService = (() => {
  let _firestore = null;
  let _auth = null;
  let _storage = null;
  let _initialized = false;

  /**
   * Initialize Firebase if config is provided
   */
  async function initialize() {
    if (!APP_CONFIG.firebase.enabled) return false;

    try {
      // Firebase SDK must be loaded via CDN in HTML
      const app = firebase.initializeApp(APP_CONFIG.firebase);
      _firestore = firebase.firestore(app);
      _auth = firebase.auth(app);
      _storage = firebase.storage(app);
      _initialized = true;
      return true;
    } catch (err) {
      console.warn('[Firebase] Initialization failed:', err.message);
      return false;
    }
  }

  /**
   * Sign in with Google
   */
  async function signInWithGoogle() {
    if (!_initialized) return null;
    const provider = new firebase.auth.GoogleAuthProvider();
    const result = await _auth.signInWithPopup(provider);
    return result.user;
  }

  /**
   * Sign out
   */
  async function signOut() {
    if (!_initialized) return;
    await _auth.signOut();
  }

  /**
   * Push local study logs to Firestore
   */
  async function syncStudyLogs(userId, logs) {
    if (!_initialized || !_firestore) return;
    const batch = _firestore.batch();
    const col = _firestore.collection(`users/${userId}/studyLogs`);
    logs.forEach((log) => {
      const ref = col.doc(log.id);
      batch.set(ref, { ...log, syncedAt: Date.now() }, { merge: true });
    });
    await batch.commit();
  }

  /**
   * Upload image to Firebase Storage, return download URL
   */
  async function uploadImage(userId, noteId, base64Data) {
    if (!_initialized || !_storage) return null;
    const ref = _storage.ref(`users/${userId}/notes/${noteId}.jpg`);
    await ref.putString(base64Data, 'data_url');
    return await ref.getDownloadURL();
  }

  /**
   * Pull remote study logs and merge into local DB (last-write-wins)
   */
  async function pullStudyLogs(userId) {
    if (!_initialized || !_firestore) return [];
    const snap = await _firestore
      .collection(`users/${userId}/studyLogs`)
      .get();
    const remote = snap.docs.map((d) => d.data());
    const local = await Database.getAll(APP_CONFIG.db.stores.studyLogs, 'userId', userId);

    const merged = [...local];
    for (const remoteLog of remote) {
      const idx = merged.findIndex((l) => l.id === remoteLog.id);
      if (idx === -1) {
        merged.push(remoteLog);
        await Database.put(APP_CONFIG.db.stores.studyLogs, remoteLog);
      } else if (remoteLog.updatedAt > merged[idx].updatedAt) {
        merged[idx] = remoteLog;
        await Database.put(APP_CONFIG.db.stores.studyLogs, remoteLog);
      }
    }
    return merged;
  }

  return { initialize, signInWithGoogle, signOut, syncStudyLogs, uploadImage, pullStudyLogs };
})();

/* ============================================================
   SECTION 9 — OCR SERVICE (Google ML Kit via Web API)
   ============================================================ */

const OCRService = (() => {
  /**
   * Attempt text extraction from an image using the
   * browser's built-in ML capabilities or a local fallback.
   * For production: swap body with a call to Google Vision API.
   */
  async function extractText(imageBase64) {
    // Production: call Google Vision API
    // const res = await fetch('https://vision.googleapis.com/v1/images:annotate?key=API_KEY', {
    //   method: 'POST',
    //   body: JSON.stringify({
    //     requests: [{
    //       image: { content: imageBase64.split(',')[1] },
    //       features: [{ type: 'TEXT_DETECTION' }],
    //     }],
    //   }),
    // });
    // const data = await res.json();
    // return data.responses[0]?.fullTextAnnotation?.text || '';

    // Offline fallback — return empty string
    return '';
  }

  return { extractText };
})();

/* ============================================================
   SECTION 10 — EXPORT SERVICE
   ============================================================ */

const ExportService = (() => {
  /**
   * Export all study logs to a JSON file download
   */
  function exportJSON() {
    const state = Store.getState();
    const exportData = {
      exportedAt: new Date().toISOString(),
      version: APP_CONFIG.version,
      studyLogs: state.studyLogs,
      routines: state.routines,
      notes: state.notes.map((n) => ({ ...n, imageBase64: null })), // strip images for size
      tags: state.tags,
      points: state.points,
      streak: state.streak,
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: 'application/json',
    });
    _downloadBlob(blob, `SmartStudy_backup_${Utils.toDateString()}.json`);
  }

  /**
   * Import study data from a JSON backup file
   */
  async function importJSON(file) {
    const text = await file.text();
    const data = JSON.parse(text);

    if (data.studyLogs) await Database.putBatch(APP_CONFIG.db.stores.studyLogs, data.studyLogs);
    if (data.routines) await Database.putBatch(APP_CONFIG.db.stores.routines, data.routines);
    if (data.notes) await Database.putBatch(APP_CONFIG.db.stores.notes, data.notes);
    if (data.tags) await Database.putBatch(APP_CONFIG.db.stores.tags, data.tags);

    return data;
  }

  /**
   * Export dashboard as PNG snapshot
   */
  async function exportImage(elementId = 'dashboard-root') {
    if (!window.html2canvas) {
      UI.showToast('html2canvas not loaded', 'error');
      return;
    }
    const el = document.getElementById(elementId);
    if (!el) return;
    const canvas = await html2canvas(el, { scale: 2 });
    canvas.toBlob((blob) => {
      _downloadBlob(blob, `SmartStudy_snapshot_${Utils.toDateString()}.png`);
    });
  }

  /**
   * Export study logs as PDF
   */
  async function exportPDF() {
    if (!window.jsPDF) {
      UI.showToast('jsPDF not loaded', 'error');
      return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const logs = Store.getState('studyLogs');

    doc.setFontSize(18);
    doc.text('Smart Study — Study Log Report', 14, 20);
    doc.setFontSize(10);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 28);

    let y = 38;
    logs.forEach((log, i) => {
      if (y > 270) { doc.addPage(); y = 20; }
      doc.setFontSize(12);
      doc.text(`${i + 1}. ${log.subject} — ${log.topic}`, 14, y);
      y += 6;
      doc.setFontSize(9);
      doc.text(
        `Date: ${log.date}  |  Duration: ${Utils.formatDuration(log.durationMinutes)}  |  Points: ${log.pointsEarned}`,
        14, y
      );
      y += 5;
      if (log.notes) {
        const lines = doc.splitTextToSize(log.notes, 180);
        doc.text(lines, 14, y);
        y += lines.length * 4;
      }
      y += 4;
    });

    doc.save(`SmartStudy_report_${Utils.toDateString()}.pdf`);
  }

  /**
   * Web Share API
   */
  async function shareData() {
    if (!navigator.share) {
      UI.showToast('Web Share not supported on this device', 'warning');
      return;
    }
    const streak = Store.getState('streak');
    const points = Store.getState('points');
    await navigator.share({
      title: 'My Study Stats — SmartStudy',
      text: `📚 Streak: ${streak?.current || 0} days | 🏆 Points: ${points?.total || 0} | Level: ${points?.levelName || 'Beginner'}`,
      url: window.location.href,
    });
  }

  function _downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return { exportJSON, importJSON, exportImage, exportPDF, shareData };
})();

/* ============================================================
   SECTION 11 — REPOSITORY LAYER (Data Access)
   ============================================================ */

const RoutineRepo = (() => {
  const STORE = APP_CONFIG.db.stores.routines;

  async function getAll(userId) {
    return Database.getAll(STORE, 'userId', userId);
  }

  async function save(routine) {
    const rec = { ...routine, updatedAt: Date.now() };
    await Database.put(STORE, rec);
    return rec;
  }

  async function remove(id) {
    return Database.remove(STORE, id);
  }

  /**
   * Detect time-slot conflicts for a given day
   */
  async function detectConflicts(routine, userId) {
    const all = await getAll(userId);
    return all.filter(
      (r) =>
        r.id !== routine.id &&
        r.dayOfWeek === routine.dayOfWeek &&
        r.isActive &&
        Utils.timesOverlap(routine.startTime, routine.endTime, r.startTime, r.endTime)
    );
  }

  return { getAll, save, remove, detectConflicts };
})();

const StudyLogRepo = (() => {
  const STORE = APP_CONFIG.db.stores.studyLogs;

  async function getAll(userId) {
    return Database.getAll(STORE, 'userId', userId);
  }

  async function getByDate(userId, date) {
    const all = await getAll(userId);
    return all.filter((l) => l.date === date);
  }

  async function getByDateRange(userId, startDate, endDate) {
    const all = await getAll(userId);
    return all.filter((l) => l.date >= startDate && l.date <= endDate);
  }

  async function save(log) {
    const rec = { ...log, updatedAt: Date.now() };
    await Database.put(STORE, rec);
    return rec;
  }

  async function remove(id) {
    return Database.remove(STORE, id);
  }

  return { getAll, getByDate, getByDateRange, save, remove };
})();

const NoteRepo = (() => {
  const STORE = APP_CONFIG.db.stores.notes;

  async function getAll(userId) {
    return Database.getAll(STORE, 'userId', userId);
  }

  async function getByStudyLog(studyLogId) {
    return Database.getAll(STORE, 'studyLogId', studyLogId);
  }

  async function save(note) {
    const rec = { ...note, updatedAt: Date.now() };
    await Database.put(STORE, rec);
    return rec;
  }

  async function remove(id) {
    return Database.remove(STORE, id);
  }

  return { getAll, getByStudyLog, save, remove };
})();

const TagRepo = (() => {
  const STORE = APP_CONFIG.db.stores.tags;

  async function getAll(userId) {
    return Database.getAll(STORE, 'userId', userId);
  }

  async function save(tag) {
    return Database.put(STORE, tag);
  }

  async function remove(id) {
    return Database.remove(STORE, id);
  }

  return { getAll, save, remove };
})();

/* ============================================================
   SECTION 12 — ANALYTICS ENGINE
   ============================================================ */

const Analytics = (() => {
  /**
   * Compute weekly stats for the current 7-day window
   */
  function weeklyStats(logs, weekDates) {
    const map = {};
    weekDates.forEach((d) => (map[d] = { totalMinutes: 0, sessions: 0 }));
    logs.forEach((log) => {
      if (map[log.date]) {
        map[log.date].totalMinutes += log.durationMinutes;
        map[log.date].sessions += 1;
      }
    });
    return weekDates.map((d) => map[d]);
  }

  /**
   * Subject-wise breakdown for a set of logs
   */
  function subjectBreakdown(logs) {
    const map = {};
    logs.forEach((log) => {
      if (!map[log.subject]) map[log.subject] = 0;
      map[log.subject] += log.durationMinutes;
    });
    return Object.entries(map)
      .map(([subject, minutes]) => ({ subject, minutes }))
      .sort((a, b) => b.minutes - a.minutes);
  }

  /**
   * Monthly study hours by day
   */
  function monthlyStats(logs, year, month) {
    const daysInMonth = new Date(year, month, 0).getDate();
    const data = Array.from({ length: daysInMonth }, (_, i) => ({
      day: i + 1,
      minutes: 0,
    }));

    logs.forEach((log) => {
      const d = new Date(log.timestamp);
      if (d.getFullYear() === year && d.getMonth() + 1 === month) {
        data[d.getDate() - 1].minutes += log.durationMinutes;
      }
    });

    return data;
  }

  /**
   * Productivity score (0–100) based on target hours per day
   */
  function productivityScore(logs, targetMinutesPerDay = 120, days = 7) {
    const cutoff = Date.now() - days * 86400000;
    const recent = logs.filter((l) => l.timestamp >= cutoff);
    const totalMinutes = recent.reduce((sum, l) => sum + l.durationMinutes, 0);
    const target = targetMinutesPerDay * days;
    return Math.min(100, Math.round((totalMinutes / target) * 100));
  }

  /**
   * Build streak history array for heatmap
   */
  function streakHistory(logs, days = 90) {
    const map = {};
    logs.forEach((l) => {
      map[l.date] = (map[l.date] || 0) + l.durationMinutes;
    });

    const result = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      const dateStr = Utils.toDateString(d);
      result.push({ date: dateStr, minutes: map[dateStr] || 0 });
    }
    return result;
  }

  return { weeklyStats, subjectBreakdown, monthlyStats, productivityScore, streakHistory };
})();

/* ============================================================
   SECTION 13 — SEARCH ENGINE
   ============================================================ */

const SearchEngine = (() => {
  /**
   * Search across study logs, routines, notes, and tags
   */
  function search(query, { studyLogs = [], routines = [], notes = [], tags = [] }) {
    if (!query || query.trim().length < 2) return { studyLogs: [], routines: [], notes: [] };

    const q = query.toLowerCase().trim();

    const matchedLogs = studyLogs.filter(
      (l) =>
        l.subject?.toLowerCase().includes(q) ||
        l.topic?.toLowerCase().includes(q) ||
        l.notes?.toLowerCase().includes(q) ||
        l.tags?.some((t) => t.toLowerCase().includes(q))
    );

    const matchedRoutines = routines.filter(
      (r) =>
        r.subject?.toLowerCase().includes(q) ||
        r.topic?.toLowerCase().includes(q)
    );

    const matchedNotes = notes.filter(
      (n) =>
        n.title?.toLowerCase().includes(q) ||
        n.content?.toLowerCase().includes(q) ||
        n.ocrText?.toLowerCase().includes(q) ||
        n.tags?.some((t) => t.toLowerCase().includes(q))
    );

    return { studyLogs: matchedLogs, routines: matchedRoutines, notes: matchedNotes };
  }

  return { search };
})();

/* ============================================================
   SECTION 14 — APPLICATION CONTROLLER (Business Logic)
   ============================================================ */

const AppController = (() => {
  /**
   * Boot sequence — initialise DB, load state, start services
   */
  async function boot() {
    Store.mergeState('ui', { isLoading: true });

    // Open IndexedDB
    await Database.open();

    // Load or create anonymous user
    await _loadUser();

    // Load all data for the current user
    await _loadAllData();

    // Start notification services
    await NotificationService.requestPermission();
    NotificationService.scheduleDailyReminder();
    setInterval(
      () => NotificationService.checkPendingNotifications(),
      5 * 60 * 1000
    );

    // Firebase init (optional)
    await FirebaseSyncService.initialize();

    Store.mergeState('ui', { isLoading: false });
  }

  async function _loadUser() {
    // Try to find saved user
    const users = await Database.getAll(APP_CONFIG.db.stores.users);
    let user = users[0] || null;

    if (!user) {
      // First launch: create a fresh user with no pre-filled name
      user = Models.createUser({ name: '' });
      await Database.put(APP_CONFIG.db.stores.users, user);
    }

    Store.setState('currentUser', user);
  }

  async function _loadAllData() {
    const userId = Store.getState('currentUser')?.id;
    if (!userId) return;

    const [routines, studyLogs, notes, tags, pointsArr, streakArr] = await Promise.all([
      RoutineRepo.getAll(userId),
      StudyLogRepo.getAll(userId),
      NoteRepo.getAll(userId),
      TagRepo.getAll(userId),
      Database.getAll(APP_CONFIG.db.stores.points, 'userId', userId),
      Database.getAll(APP_CONFIG.db.stores.streaks, 'userId', userId),
    ]);

    Store.setState('routines', routines);
    Store.setState('studyLogs', studyLogs);
    Store.setState('notes', notes);
    Store.setState('tags', tags);
    Store.setState('points', pointsArr[0] || null);
    Store.setState('streak', streakArr[0] || null);
  }

  /* ---- Routine CRUD ---- */

  async function addRoutine(data) {
    const userId = Store.getState('currentUser')?.id;
    const routine = Models.createRoutine({ ...data, userId });

    // Conflict detection
    const conflicts = await RoutineRepo.detectConflicts(routine, userId);
    if (conflicts.length > 0) {
      return { success: false, conflicts };
    }

    const saved = await RoutineRepo.save(routine);
    Store.pushItem('routines', saved);
    UI.showToast('Routine added! 📅', 'success');
    return { success: true, routine: saved };
  }

  async function updateRoutine(id, data) {
    const existing = Store.getState('routines').find((r) => r.id === id);
    if (!existing) return;
    const updated = { ...existing, ...data };
    await RoutineRepo.save(updated);
    Store.updateItem('routines', id, data);
    UI.showToast('Routine updated!', 'success');
  }

  async function deleteRoutine(id) {
    await RoutineRepo.remove(id);
    Store.removeItem('routines', id);
    UI.showToast('Routine deleted', 'info');
  }

  /* ---- Study Log CRUD ---- */

  async function addStudyLog(data) {
    const userId = Store.getState('currentUser')?.id;
    const log = Models.createStudyLog({ ...data, userId });

    // Gamification
    const streakCount = await GamificationService.updateStreak();
    const reward = await GamificationService.awardSessionPoints(log.id, streakCount);
    log.pointsEarned = reward?.earned || 0;

    const saved = await StudyLogRepo.save(log);
    Store.pushItem('studyLogs', saved);

    // Schedule revision reminders
    await NotificationService.scheduleRevisionReminders(saved);

    UI.showToast(
      `Session logged! +${log.pointsEarned} pts 🎉`,
      'success'
    );

    if (reward?.streakBonus > 0) {
      UI.showToast(
        `🔥 Streak bonus! +${reward.streakBonus} pts`,
        'info'
      );
    }

    return saved;
  }

  async function updateStudyLog(id, data) {
    const existing = Store.getState('studyLogs').find((l) => l.id === id);
    if (!existing) return;
    const updated = { ...existing, ...data };
    await StudyLogRepo.save(updated);
    Store.updateItem('studyLogs', id, data);
    UI.showToast('Study log updated!', 'success');
  }

  async function deleteStudyLog(id) {
    await StudyLogRepo.remove(id);
    Store.removeItem('studyLogs', id);
    UI.showToast('Log entry deleted', 'info');
  }

  /* ---- Note CRUD ---- */

  async function addNote(data, imageFile = null) {
    const userId = Store.getState('currentUser')?.id;
    const note = Models.createNote({ ...data, userId });

    if (imageFile) {
      note.imageBase64 = await Utils.fileToBase64(imageFile);
      note.ocrText = await OCRService.extractText(note.imageBase64);
    }

    const saved = await NoteRepo.save(note);
    Store.pushItem('notes', saved);
    UI.showToast('Note saved! 📝', 'success');
    return saved;
  }

  async function deleteNote(id) {
    await NoteRepo.remove(id);
    Store.removeItem('notes', id);
    UI.showToast('Note deleted', 'info');
  }

  /* ---- Tags CRUD ---- */

  async function addTag(name, color) {
    const userId = Store.getState('currentUser')?.id;
    const tag = Models.createTag({ userId, name, color });
    await TagRepo.save(tag);
    Store.pushItem('tags', tag);
    return tag;
  }

  async function deleteTag(id) {
    await TagRepo.remove(id);
    Store.removeItem('tags', id);
  }

  /* ---- Search ---- */

  function performSearch(query) {
    const state = Store.getState();
    return SearchEngine.search(query, {
      studyLogs: state.studyLogs,
      routines: state.routines,
      notes: state.notes,
    });
  }

  /* ---- Profile update ---- */

  async function updateProfile(data) {
    const current = Store.getState('currentUser');
    const updated = { ...current, ...data, updatedAt: Date.now() };
    await Database.put(APP_CONFIG.db.stores.users, updated);
    Store.setState('currentUser', updated);
    UI.showToast('Profile updated!', 'success');
  }

  return {
    boot,
    addRoutine, updateRoutine, deleteRoutine,
    addStudyLog, updateStudyLog, deleteStudyLog,
    addNote, deleteNote,
    addTag, deleteTag,
    performSearch, updateProfile,
  };
})();

/* ============================================================
   SECTION 15 — CHART RENDERER (fl_chart equivalent in JS)
   ============================================================ */

const ChartRenderer = (() => {
  const _instances = new Map();

  function _destroyIfExists(id) {
    if (_instances.has(id)) {
      _instances.get(id).destroy();
      _instances.delete(id);
    }
  }

  function getSubjectColor(index) {
    return APP_CONFIG.subjectColors[index % APP_CONFIG.subjectColors.length];
  }

  /**
   * Weekly study hours bar chart
   */
  function renderWeeklyChart(canvasId, logs, weekDates) {
    _destroyIfExists(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx || !window.Chart) return;

    const stats = Analytics.weeklyStats(logs, weekDates);
    const labels = weekDates.map((d, i) => Utils.DAY_LABELS[i]);
    const data = stats.map((s) => +(s.totalMinutes / 60).toFixed(1));

    const chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Study Hours',
          data,
          backgroundColor: 'rgba(52, 152, 219, 0.7)',
          borderColor: '#2980B9',
          borderWidth: 2,
          borderRadius: 6,
        }],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.raw}h`,
            },
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            title: { display: true, text: 'Hours' },
          },
        },
      },
    });

    _instances.set(canvasId, chart);
    return chart;
  }

  /**
   * Subject-wise doughnut chart
   */
  function renderSubjectChart(canvasId, logs) {
    _destroyIfExists(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx || !window.Chart) return;

    const breakdown = Analytics.subjectBreakdown(logs);
    if (!breakdown.length) return;

    const chart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: breakdown.map((b) => b.subject),
        datasets: [{
          data: breakdown.map((b) => +(b.minutes / 60).toFixed(1)),
          backgroundColor: breakdown.map((_, i) => getSubjectColor(i)),
          borderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'right' },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.label}: ${ctx.raw}h`,
            },
          },
        },
      },
    });

    _instances.set(canvasId, chart);
    return chart;
  }

  /**
   * Monthly study line chart
   */
  function renderMonthlyChart(canvasId, logs) {
    _destroyIfExists(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx || !window.Chart) return;

    const now = new Date();
    const data = Analytics.monthlyStats(logs, now.getFullYear(), now.getMonth() + 1);

    const chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: data.map((d) => d.day),
        datasets: [{
          label: 'Minutes',
          data: data.map((d) => d.minutes),
          fill: true,
          backgroundColor: 'rgba(46, 204, 113, 0.2)',
          borderColor: '#27AE60',
          tension: 0.4,
          pointRadius: 3,
        }],
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, title: { display: true, text: 'Minutes' } },
          x: { title: { display: true, text: 'Day of Month' } },
        },
      },
    });

    _instances.set(canvasId, chart);
    return chart;
  }

  /**
   * Streak heatmap — rendered as SVG grid
   */
  function renderStreakHeatmap(containerId, logs) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const history = Analytics.streakHistory(logs, 91);
    const max = Math.max(...history.map((d) => d.minutes), 1);

    // Build 13 weeks × 7 days grid
    const weeks = [];
    for (let i = 0; i < 13; i++) {
      weeks.push(history.slice(i * 7, i * 7 + 7));
    }

    const CELL = 14;
    const GAP = 2;
    const W = 13 * (CELL + GAP);
    const H = 7 * (CELL + GAP) + 20;

    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;
    svg += `<text x="0" y="11" font-size="10" fill="#666">Last 13 weeks</text>`;

    weeks.forEach((week, wi) => {
      week.forEach((day, di) => {
        const intensity = day.minutes / max;
        const opacity = day.minutes === 0 ? 0.07 : 0.2 + intensity * 0.8;
        const x = wi * (CELL + GAP);
        const y = di * (CELL + GAP) + 16;
        svg += `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}"
          rx="3" ry="3"
          fill="rgba(52,152,219,${opacity.toFixed(2)})"
          data-date="${day.date}" data-minutes="${day.minutes}">
          <title>${day.date}: ${Utils.formatDuration(day.minutes)}</title>
        </rect>`;
      });
    });

    svg += '</svg>';
    container.innerHTML = svg;
  }

  return {
    renderWeeklyChart, renderSubjectChart,
    renderMonthlyChart, renderStreakHeatmap,
  };
})();

/* ============================================================
   SECTION 16 — UI RENDERER
   ============================================================ */

const UI = (() => {
  let _toastTimer = null;

  /**
   * Navigate to a page
   */
  function navigate(page) {
    Store.mergeState('ui', { activePage: page });
    _renderPage(page);
    _updateNavBar(page);
  }

  /**
   * Show a toast notification
   */
  function showToast(message, type = 'info', duration = 3000) {
    clearTimeout(_toastTimer);
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.className = `toast toast--${type} toast--visible`;
    _toastTimer = setTimeout(() => toast.classList.remove('toast--visible'), duration);
  }

  /**
   * Open a modal
   */
  function openModal(content, title = '') {
    const overlay = document.getElementById('modal-overlay');
    const modalTitle = document.getElementById('modal-title');
    const modalBody = document.getElementById('modal-body');
    if (!overlay) return;
    modalTitle.textContent = title;
    modalBody.innerHTML = content;
    overlay.classList.add('modal-overlay--visible');
  }

  /**
   * Close the active modal
   */
  function closeModal() {
    const overlay = document.getElementById('modal-overlay');
    if (overlay) overlay.classList.remove('modal-overlay--visible');
  }

  /**
   * Update bottom nav active state
   */
  function _updateNavBar(page) {
    document.querySelectorAll('[data-nav]').forEach((btn) => {
      btn.classList.toggle('nav-btn--active', btn.dataset.nav === page);
    });
  }

  /**
   * Route to the correct page renderer
   */
  function _renderPage(page) {
    const root = document.getElementById('page-root');
    if (!root) return;

    const pages = {
      dashboard: renderDashboard,
      planner: renderPlanner,
      logs: renderLogs,
      notes: renderNotes,
      progress: renderProgress,
      search: renderSearch,
      settings: renderSettings,
    };

    root.innerHTML = '';
    const renderer = pages[page];
    if (renderer) renderer(root);
  }

  /* ---- PAGE: DASHBOARD ---- */

  function renderDashboard(container) {
    const user = Store.getState('currentUser');
    const streak = Store.getState('streak');
    const points = Store.getState('points');
    const logs = Store.getState('studyLogs');
    const routines = Store.getState('routines');

    const today = Utils.toDateString();
    const todayLogs = logs.filter((l) => l.date === today);
    const todayMinutes = todayLogs.reduce((s, l) => s + l.durationMinutes, 0);
    const score = Analytics.productivityScore(logs);
    const levelInfo = GamificationService.calculateLevel(points?.total || 0);
    const msg = GamificationService.getMotivationalMessage(streak?.current || 0);

    // Today's routines
    const todayDow = new Date().getDay() || 7; // Convert 0=Sun to 7
    const todayRoutines = routines.filter(
      (r) => r.isActive && r.dayOfWeek === todayDow
    );

    container.innerHTML = `
      <div class="dashboard" id="dashboard-root">
        <div class="dashboard__header">
          <div>
            <h1 class="dashboard__greeting">${user?.name
              ? `Hello, ${Utils.sanitizeHTML(user.name)} 👋`
              : `Welcome! <button class="btn btn--link" onclick="UI.navigate('settings')" style="font-size:inherit;font-weight:800;">Set your name →</button>`
            }</h1>
            <p class="dashboard__date">${new Date().toLocaleDateString(navigator.language, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
          </div>
          <div class="dashboard__avatar" title="Profile">${(user?.name || 'S')[0].toUpperCase()}</div>
        </div>

        <div class="motivational-banner">
          <span class="motivational-banner__icon">💡</span>
          <p>${Utils.sanitizeHTML(msg)}</p>
        </div>

        <div class="stat-grid">
          <div class="stat-card stat-card--streak">
            <div class="stat-card__icon">🔥</div>
            <div class="stat-card__value">${streak?.current || 0}</div>
            <div class="stat-card__label">Day Streak</div>
          </div>
          <div class="stat-card stat-card--points">
            <div class="stat-card__icon">${levelInfo.icon}</div>
            <div class="stat-card__value">${points?.total || 0}</div>
            <div class="stat-card__label">${levelInfo.name}</div>
          </div>
          <div class="stat-card stat-card--today">
            <div class="stat-card__icon">⏱️</div>
            <div class="stat-card__value">${Utils.formatDuration(todayMinutes)}</div>
            <div class="stat-card__label">Today</div>
          </div>
          <div class="stat-card stat-card--score">
            <div class="stat-card__icon">📈</div>
            <div class="stat-card__value">${score}%</div>
            <div class="stat-card__label">Productivity</div>
          </div>
        </div>

        <div class="section-header">
          <h2>Today's Schedule</h2>
          <button class="btn btn--ghost" onclick="UI.navigate('planner')">View All</button>
        </div>

        <div class="routine-list">
          ${todayRoutines.length === 0
            ? '<p class="empty-state">No routines scheduled for today. <button class="btn btn--link" onclick="UI.navigate(\'planner\')">Add one →</button></p>'
            : todayRoutines.map((r) => `
              <div class="routine-card" style="border-left-color:${r.color}">
                <div class="routine-card__time">${r.startTime} – ${r.endTime}</div>
                <div class="routine-card__info">
                  <strong>${Utils.sanitizeHTML(r.subject)}</strong>
                  <span>${Utils.sanitizeHTML(r.topic)}</span>
                </div>
                <button class="btn btn--sm btn--primary" onclick="UI.openQuickLogModal('${r.id}')">Log</button>
              </div>
            `).join('')
          }
        </div>

        <div class="section-header">
          <h2>Recent Sessions</h2>
          <button class="btn btn--ghost" onclick="UI.navigate('logs')">View All</button>
        </div>
        <div class="log-list">
          ${logs.slice(-5).reverse().map((l) => `
            <div class="log-card">
              <div class="log-card__subject" style="background:${_subjectBadgeColor(l.subject)}">${Utils.sanitizeHTML(l.subject)}</div>
              <div class="log-card__info">
                <strong>${Utils.sanitizeHTML(l.topic)}</strong>
                <span>${l.date} · ${Utils.formatDuration(l.durationMinutes)}</span>
              </div>
              <div class="log-card__points">+${l.pointsEarned}pts</div>
            </div>
          `).join('') || '<p class="empty-state">No study sessions yet. Start learning! 🚀</p>'}
        </div>

        <button class="fab" onclick="UI.openAddLogModal()" title="Log Study Session">
          <span>+</span>
        </button>
      </div>
    `;
  }

  /* ---- PAGE: PLANNER ---- */

  function renderPlanner(container) {
    const routines = Store.getState('routines');
    const weekOffset = Store.getState('ui').weekOffset || 0;

    container.innerHTML = `
      <div class="planner">
        <div class="page-header">
          <h1>Weekly Planner</h1>
          <button class="btn btn--primary" onclick="UI.openAddRoutineModal()">+ Add Routine</button>
        </div>

        <div class="week-grid">
          ${Utils.DAY_LABELS.map((day, idx) => {
            const dow = idx + 1; // 1=Mon
            const dayRoutines = routines
              .filter((r) => r.dayOfWeek === dow && r.isActive)
              .sort((a, b) => a.startTime.localeCompare(b.startTime));

            return `
              <div class="week-col">
                <div class="week-col__header">${day}</div>
                ${dayRoutines.map((r) => `
                  <div class="routine-block" style="background:${r.color}22;border-left:3px solid ${r.color}"
                    onclick="UI.openEditRoutineModal('${r.id}')">
                    <div class="routine-block__time">${r.startTime}</div>
                    <div class="routine-block__subject">${Utils.sanitizeHTML(r.subject)}</div>
                    <div class="routine-block__topic">${Utils.sanitizeHTML(r.topic)}</div>
                  </div>
                `).join('') || `<div class="week-col__empty">—</div>`}
              </div>
            `;
          }).join('')}
        </div>

        <div class="section-header" style="margin-top:1.5rem">
          <h2>All Routines</h2>
        </div>
        <div class="routine-list">
          ${routines.length === 0
            ? '<p class="empty-state">No routines yet. Click "+ Add Routine" to get started.</p>'
            : routines.map((r) => `
              <div class="routine-card" style="border-left-color:${r.color}">
                <div class="routine-card__time">${Utils.DAY_LABELS[r.dayOfWeek - 1]} · ${r.startTime}–${r.endTime}</div>
                <div class="routine-card__info">
                  <strong>${Utils.sanitizeHTML(r.subject)}</strong>
                  <span>${Utils.sanitizeHTML(r.topic)}</span>
                </div>
                <div class="routine-card__actions">
                  <button class="btn btn--sm btn--ghost" onclick="UI.openEditRoutineModal('${r.id}')">Edit</button>
                  <button class="btn btn--sm btn--danger" onclick="AppController.deleteRoutine('${r.id}').then(()=>UI.navigate('planner'))">Del</button>
                </div>
              </div>
            `).join('')
          }
        </div>
      </div>
    `;
  }

  /* ---- PAGE: STUDY LOGS ---- */

  function renderLogs(container) {
    const logs = [...Store.getState('studyLogs')].reverse();
    const selectedDate = Store.getState('ui').selectedDate;

    const filteredLogs = selectedDate
      ? logs.filter((l) => l.date === selectedDate)
      : logs;

    container.innerHTML = `
      <div class="logs-page">
        <div class="page-header">
          <h1>Study Log</h1>
          <button class="btn btn--primary" onclick="UI.openAddLogModal()">+ Log Session</button>
        </div>

        <div class="date-filter">
          <label>Filter by date:</label>
          <input type="date" id="log-date-filter" value="${selectedDate}"
            onchange="Store.mergeState('ui',{selectedDate:this.value});UI.navigate('logs')">
          <button class="btn btn--ghost btn--sm" onclick="Store.mergeState('ui',{selectedDate:''});UI.navigate('logs')">Clear</button>
        </div>

        <div class="log-list">
          ${filteredLogs.length === 0
            ? '<p class="empty-state">No study sessions recorded yet. Start learning! 📚</p>'
            : filteredLogs.map((l) => `
              <div class="log-card log-card--detailed">
                <div class="log-card__left">
                  <div class="log-card__subject" style="background:${_subjectBadgeColor(l.subject)}">${Utils.sanitizeHTML(l.subject)}</div>
                  <div class="log-card__info">
                    <strong>${Utils.sanitizeHTML(l.topic)}</strong>
                    <span>${l.date} · ${Utils.formatDuration(l.durationMinutes)}</span>
                    ${l.notes ? `<p class="log-card__notes">${Utils.sanitizeHTML(l.notes)}</p>` : ''}
                    ${l.tags?.length ? `<div class="tag-list">${l.tags.map((t) => `<span class="tag">${Utils.sanitizeHTML(t)}</span>`).join('')}</div>` : ''}
                  </div>
                </div>
                <div class="log-card__right">
                  <div class="log-card__points">+${l.pointsEarned}pts</div>
                  <div class="log-card__actions">
                    <button class="btn btn--sm btn--ghost" onclick="UI.openEditLogModal('${l.id}')">Edit</button>
                    <button class="btn btn--sm btn--danger" onclick="AppController.deleteStudyLog('${l.id}').then(()=>UI.navigate('logs'))">Del</button>
                  </div>
                </div>
              </div>
            `).join('')
          }
        </div>
      </div>
    `;
  }

  /* ---- PAGE: NOTES ---- */

  function renderNotes(container) {
    const notes = [...Store.getState('notes')].reverse();

    container.innerHTML = `
      <div class="notes-page">
        <div class="page-header">
          <h1>Notes</h1>
          <button class="btn btn--primary" onclick="UI.openAddNoteModal()">+ Add Note</button>
        </div>

        <div class="notes-grid">
          ${notes.length === 0
            ? '<p class="empty-state" style="grid-column:1/-1">No notes yet. Capture your first note! ✏️</p>'
            : notes.map((n) => `
              <div class="note-card">
                ${n.imageBase64
                  ? `<div class="note-card__img-wrap"><img src="${n.imageBase64}" alt="Note image" onclick="UI.openImagePreview('${n.id}')" loading="lazy"></div>`
                  : ''}
                <div class="note-card__body">
                  <h3>${Utils.sanitizeHTML(n.title || 'Untitled')}</h3>
                  <p>${Utils.sanitizeHTML(n.content?.slice(0, 120) || '')}${(n.content?.length || 0) > 120 ? '…' : ''}</p>
                  ${n.ocrText ? `<p class="note-card__ocr">🔍 ${Utils.sanitizeHTML(n.ocrText.slice(0, 60))}…</p>` : ''}
                  ${n.tags?.length ? `<div class="tag-list">${n.tags.map((t) => `<span class="tag">${Utils.sanitizeHTML(t)}</span>`).join('')}</div>` : ''}
                  <div class="note-card__footer">
                    <span>${Utils.formatDateTime(n.createdAt)}</span>
                    <button class="btn btn--sm btn--danger" onclick="AppController.deleteNote('${n.id}').then(()=>UI.navigate('notes'))">Delete</button>
                  </div>
                </div>
              </div>
            `).join('')
          }
        </div>
      </div>
    `;
  }

  /* ---- PAGE: PROGRESS ---- */

  function renderProgress(container) {
    const logs = Store.getState('studyLogs');
    const streak = Store.getState('streak');
    const points = Store.getState('points');
    const weekDates = Utils.getWeekDates();
    const score = Analytics.productivityScore(logs);
    const levelInfo = GamificationService.calculateLevel(points?.total || 0);

    // Next level progress
    const levels = APP_CONFIG.gamification.levels;
    const currentLevelIdx = levels.findIndex((l) => l.level === levelInfo.level);
    const nextLevel = levels[currentLevelIdx + 1];
    const progressPct = nextLevel
      ? Math.round(((points?.total || 0) - levelInfo.minPoints) / (nextLevel.minPoints - levelInfo.minPoints) * 100)
      : 100;

    container.innerHTML = `
      <div class="progress-page">
        <div class="page-header">
          <h1>Progress Analytics</h1>
          <button class="btn btn--ghost" onclick="ExportService.exportPDF()">Export PDF</button>
        </div>

        <div class="level-card">
          <div class="level-card__icon">${levelInfo.icon}</div>
          <div class="level-card__info">
            <div class="level-card__name">Level ${levelInfo.level}: ${levelInfo.name}</div>
            <div class="level-card__points">${points?.total || 0} points</div>
            ${nextLevel ? `<div class="progress-bar"><div class="progress-bar__fill" style="width:${progressPct}%"></div></div>
            <div class="level-card__next">${progressPct}% to Level ${nextLevel.level}</div>` : '<div class="level-card__next">🏆 Max Level!</div>'}
          </div>
        </div>

        <div class="stat-grid">
          <div class="stat-card">
            <div class="stat-card__icon">🔥</div>
            <div class="stat-card__value">${streak?.current || 0}</div>
            <div class="stat-card__label">Current Streak</div>
          </div>
          <div class="stat-card">
            <div class="stat-card__icon">⭐</div>
            <div class="stat-card__value">${streak?.longest || 0}</div>
            <div class="stat-card__label">Best Streak</div>
          </div>
          <div class="stat-card">
            <div class="stat-card__icon">📊</div>
            <div class="stat-card__value">${score}%</div>
            <div class="stat-card__label">Productivity</div>
          </div>
          <div class="stat-card">
            <div class="stat-card__icon">📚</div>
            <div class="stat-card__value">${logs.length}</div>
            <div class="stat-card__label">Total Sessions</div>
          </div>
        </div>

        <div class="chart-section">
          <h2>Weekly Study Hours</h2>
          <div class="chart-wrap"><canvas id="chart-weekly"></canvas></div>
        </div>

        <div class="chart-section">
          <h2>Subject Breakdown</h2>
          <div class="chart-wrap"><canvas id="chart-subject"></canvas></div>
        </div>

        <div class="chart-section">
          <h2>Monthly Activity</h2>
          <div class="chart-wrap"><canvas id="chart-monthly"></canvas></div>
        </div>

        <div class="chart-section">
          <h2>Study Heatmap (Last 13 Weeks)</h2>
          <div class="heatmap-wrap" id="streak-heatmap"></div>
        </div>

        <div class="export-section">
          <h2>Export</h2>
          <div class="export-btns">
            <button class="btn btn--primary" onclick="ExportService.exportJSON()">📦 Backup JSON</button>
            <button class="btn btn--primary" onclick="ExportService.exportPDF()">📄 Export PDF</button>
            <button class="btn btn--primary" onclick="ExportService.shareData()">🔗 Share Stats</button>
          </div>
        </div>
      </div>
    `;

    // Render charts asynchronously
    requestAnimationFrame(() => {
      ChartRenderer.renderWeeklyChart('chart-weekly', logs, weekDates);
      ChartRenderer.renderSubjectChart('chart-subject', logs);
      ChartRenderer.renderMonthlyChart('chart-monthly', logs);
      ChartRenderer.renderStreakHeatmap('streak-heatmap', logs);
    });
  }

  /* ---- PAGE: SEARCH ---- */

  function renderSearch(container) {
    container.innerHTML = `
      <div class="search-page">
        <div class="page-header">
          <h1>Search</h1>
        </div>

        <div class="search-bar">
          <span class="search-bar__icon">🔍</span>
          <input type="text" id="search-input" placeholder="Search subjects, topics, notes, tags…"
            autofocus autocomplete="off"
            oninput="UI._handleSearchInput(this.value)">
        </div>

        <div id="search-results" class="search-results">
          <p class="empty-state">Type to search across all your study data.</p>
        </div>
      </div>
    `;
  }

  const _handleSearchInput = Utils.debounce((query) => {
    const resultsEl = document.getElementById('search-results');
    if (!resultsEl) return;

    if (!query || query.trim().length < 2) {
      resultsEl.innerHTML = '<p class="empty-state">Type to search across all your study data.</p>';
      return;
    }

    const results = AppController.performSearch(query);
    const { studyLogs, routines, notes } = results;
    const total = studyLogs.length + routines.length + notes.length;

    if (total === 0) {
      resultsEl.innerHTML = `<p class="empty-state">No results for "${Utils.sanitizeHTML(query)}"</p>`;
      return;
    }

    let html = `<p class="search-count">${total} result${total !== 1 ? 's' : ''} for "${Utils.sanitizeHTML(query)}"</p>`;

    if (studyLogs.length) {
      html += `<div class="search-group"><h3>Study Logs (${studyLogs.length})</h3>`;
      html += studyLogs.map((l) => `
        <div class="log-card">
          <div class="log-card__subject" style="background:${_subjectBadgeColor(l.subject)}">${Utils.sanitizeHTML(l.subject)}</div>
          <div class="log-card__info">
            <strong>${Utils.highlightText(Utils.sanitizeHTML(l.topic), query)}</strong>
            <span>${l.date} · ${Utils.formatDuration(l.durationMinutes)}</span>
          </div>
        </div>
      `).join('');
      html += '</div>';
    }

    if (routines.length) {
      html += `<div class="search-group"><h3>Routines (${routines.length})</h3>`;
      html += routines.map((r) => `
        <div class="routine-card" style="border-left-color:${r.color}">
          <div class="routine-card__time">${Utils.DAY_LABELS[r.dayOfWeek - 1]} · ${r.startTime}–${r.endTime}</div>
          <div class="routine-card__info">
            <strong>${Utils.highlightText(Utils.sanitizeHTML(r.subject), query)}</strong>
          </div>
        </div>
      `).join('');
      html += '</div>';
    }

    if (notes.length) {
      html += `<div class="search-group"><h3>Notes (${notes.length})</h3>`;
      html += notes.map((n) => `
        <div class="note-card note-card--compact">
          <h3>${Utils.highlightText(Utils.sanitizeHTML(n.title || 'Untitled'), query)}</h3>
          <p>${Utils.highlightText(Utils.sanitizeHTML(n.content?.slice(0, 100) || ''), query)}</p>
        </div>
      `).join('');
      html += '</div>';
    }

    resultsEl.innerHTML = html;
  }, 300);

  /* ---- PAGE: SETTINGS ---- */

  function renderSettings(container) {
    const user = Store.getState('currentUser');
    const streak = Store.getState('streak');
    const points = Store.getState('points');

    container.innerHTML = `
      <div class="settings-page">
        <div class="page-header">
          <h1>Settings</h1>
        </div>

        <div class="settings-section">
          <h2>Profile</h2>
          <div class="form-group">
            <label>Display Name</label>
            <input type="text" id="setting-name" value="${Utils.sanitizeHTML(user?.name || '')}" placeholder="Your name">
          </div>
          <button class="btn btn--primary" onclick="AppController.updateProfile({name:document.getElementById('setting-name').value})">Save Profile</button>
        </div>

        <div class="settings-section">
          <h2>Stats</h2>
          <div class="settings-stat-list">
            <div class="settings-stat"><span>Current Streak</span><strong>${streak?.current || 0} days</strong></div>
            <div class="settings-stat"><span>Longest Streak</span><strong>${streak?.longest || 0} days</strong></div>
            <div class="settings-stat"><span>Total Points</span><strong>${points?.total || 0}</strong></div>
            <div class="settings-stat"><span>Level</span><strong>${points?.levelName || 'Beginner'}</strong></div>
          </div>
        </div>

        <div class="settings-section">
          <h2>Data Management</h2>
          <div class="settings-btn-group">
            <button class="btn btn--primary" onclick="ExportService.exportJSON()">📦 Export Backup</button>
            <label class="btn btn--ghost" style="cursor:pointer">
              📥 Import Backup
              <input type="file" accept=".json" style="display:none"
                onchange="ExportService.importJSON(this.files[0]).then(()=>UI.showToast('Data imported!','success'))">
            </label>
          </div>
        </div>

        <div class="settings-section">
          <h2>Notifications</h2>
          <button class="btn btn--ghost" onclick="NotificationService.requestPermission().then(granted=>UI.showToast(granted?'Notifications enabled!':'Permission denied','info'))">
            Enable Notifications
          </button>
        </div>

        <div class="settings-section settings-section--danger">
          <h2>Danger Zone</h2>
          <button class="btn btn--danger" onclick="UI._confirmClearData()">Clear All Data</button>
        </div>

        <div class="settings-section">
          <p class="settings-version">SmartStudy v${APP_CONFIG.version} — Offline-First PWA</p>
        </div>
      </div>
    `;
  }

  /* ---- MODAL: Add/Edit Routine ---- */

  function openAddRoutineModal() {
    const colors = APP_CONFIG.subjectColors;
    const content = `
      <div class="modal-form">
        <div class="form-group">
          <label>Subject *</label>
          <input type="text" id="m-subject" placeholder="e.g. Mathematics" required>
        </div>
        <div class="form-group">
          <label>Topic</label>
          <input type="text" id="m-topic" placeholder="e.g. Calculus - Integration">
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Day of Week *</label>
            <select id="m-dow">
              ${Utils.DAY_LABELS.map((d, i) => `<option value="${i + 1}">${d}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>Start Time *</label>
            <input type="time" id="m-start" value="09:00">
          </div>
          <div class="form-group">
            <label>End Time *</label>
            <input type="time" id="m-end" value="10:00">
          </div>
        </div>
        <div class="form-group">
          <label>Color</label>
          <div class="color-picker" id="m-color-picker">
            ${colors.map((c, i) => `
              <div class="color-swatch ${i === 0 ? 'color-swatch--selected' : ''}"
                style="background:${c}" data-color="${c}"
                onclick="UI._selectColor(this,'m-color-picker')"></div>
            `).join('')}
          </div>
          <input type="hidden" id="m-color" value="${colors[0]}">
        </div>
        <div class="modal-actions">
          <button class="btn btn--ghost" onclick="UI.closeModal()">Cancel</button>
          <button class="btn btn--primary" onclick="UI._submitAddRoutine()">Add Routine</button>
        </div>
      </div>
    `;
    openModal(content, 'Add Routine');
  }

  function openEditRoutineModal(id) {
    const routine = Store.getState('routines').find((r) => r.id === id);
    if (!routine) return;

    const colors = APP_CONFIG.subjectColors;
    const content = `
      <div class="modal-form">
        <div class="form-group">
          <label>Subject</label>
          <input type="text" id="m-subject" value="${Utils.sanitizeHTML(routine.subject)}">
        </div>
        <div class="form-group">
          <label>Topic</label>
          <input type="text" id="m-topic" value="${Utils.sanitizeHTML(routine.topic)}">
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Day</label>
            <select id="m-dow">
              ${Utils.DAY_LABELS.map((d, i) => `<option value="${i + 1}" ${i + 1 === routine.dayOfWeek ? 'selected' : ''}>${d}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>Start</label>
            <input type="time" id="m-start" value="${routine.startTime}">
          </div>
          <div class="form-group">
            <label>End</label>
            <input type="time" id="m-end" value="${routine.endTime}">
          </div>
        </div>
        <div class="form-group">
          <label>Color</label>
          <div class="color-picker" id="m-color-picker">
            ${colors.map((c) => `
              <div class="color-swatch ${c === routine.color ? 'color-swatch--selected' : ''}"
                style="background:${c}" data-color="${c}"
                onclick="UI._selectColor(this,'m-color-picker')"></div>
            `).join('')}
          </div>
          <input type="hidden" id="m-color" value="${routine.color}">
        </div>
        <div class="modal-actions">
          <button class="btn btn--ghost" onclick="UI.closeModal()">Cancel</button>
          <button class="btn btn--primary" onclick="UI._submitEditRoutine('${id}')">Save Changes</button>
        </div>
      </div>
    `;
    openModal(content, 'Edit Routine');
  }

  async function _submitAddRoutine() {
    const subject = document.getElementById('m-subject')?.value.trim();
    const topic = document.getElementById('m-topic')?.value.trim();
    const dayOfWeek = parseInt(document.getElementById('m-dow')?.value, 10);
    const startTime = document.getElementById('m-start')?.value;
    const endTime = document.getElementById('m-end')?.value;
    const color = document.getElementById('m-color')?.value;

    if (!subject || !startTime || !endTime) {
      showToast('Please fill in all required fields', 'error');
      return;
    }
    if (startTime >= endTime) {
      showToast('End time must be after start time', 'error');
      return;
    }

    const result = await AppController.addRoutine({ subject, topic, dayOfWeek, startTime, endTime, color });
    if (result.success) {
      closeModal();
      navigate('planner');
    } else {
      showToast(`⚠️ Time conflict with: ${result.conflicts[0]?.subject}`, 'error');
    }
  }

  async function _submitEditRoutine(id) {
    const subject = document.getElementById('m-subject')?.value.trim();
    const topic = document.getElementById('m-topic')?.value.trim();
    const dayOfWeek = parseInt(document.getElementById('m-dow')?.value, 10);
    const startTime = document.getElementById('m-start')?.value;
    const endTime = document.getElementById('m-end')?.value;
    const color = document.getElementById('m-color')?.value;

    await AppController.updateRoutine(id, { subject, topic, dayOfWeek, startTime, endTime, color });
    closeModal();
    navigate('planner');
  }

  /* ---- MODAL: Add/Edit Study Log ---- */

  function openAddLogModal(routineId = null) {
    const routine = routineId
      ? Store.getState('routines').find((r) => r.id === routineId)
      : null;
    const tags = Store.getState('tags');

    const content = `
      <div class="modal-form">
        <div class="form-row">
          <div class="form-group">
            <label>Subject *</label>
            <input type="text" id="ml-subject" value="${Utils.sanitizeHTML(routine?.subject || '')}" placeholder="e.g. Physics">
          </div>
          <div class="form-group">
            <label>Topic *</label>
            <input type="text" id="ml-topic" value="${Utils.sanitizeHTML(routine?.topic || '')}" placeholder="e.g. Wave Optics">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Duration (minutes) *</label>
            <input type="number" id="ml-duration" min="1" max="480" value="60" placeholder="60">
          </div>
          <div class="form-group">
            <label>Date</label>
            <input type="date" id="ml-date" value="${Utils.toDateString()}">
          </div>
        </div>
        <div class="form-group">
          <label>Notes</label>
          <textarea id="ml-notes" rows="3" placeholder="What did you study? Key takeaways…"></textarea>
        </div>
        <div class="form-group">
          <label>Tags</label>
          <div class="tag-input-wrap">
            <input type="text" id="ml-tag-input" placeholder="Type and press Enter to add tag"
              onkeydown="if(event.key==='Enter'){UI._addTagToForm('ml-tag-input','ml-tag-list');event.preventDefault()}">
            <div id="ml-tag-list" class="tag-list"></div>
          </div>
          ${tags.length ? `<div class="tag-suggestions">
            ${tags.map((t) => `<span class="tag tag--clickable" style="border-color:${t.color}" onclick="UI._addTagValueToForm('${Utils.sanitizeHTML(t.name)}','ml-tag-list')">${Utils.sanitizeHTML(t.name)}</span>`).join('')}
          </div>` : ''}
        </div>
        <div class="modal-actions">
          <button class="btn btn--ghost" onclick="UI.closeModal()">Cancel</button>
          <button class="btn btn--primary" onclick="UI._submitAddLog()">Log Session</button>
        </div>
      </div>
    `;
    openModal(content, 'Log Study Session');
  }

  function openQuickLogModal(routineId) {
    openAddLogModal(routineId);
  }

  function openEditLogModal(id) {
    const log = Store.getState('studyLogs').find((l) => l.id === id);
    if (!log) return;

    const content = `
      <div class="modal-form">
        <div class="form-row">
          <div class="form-group">
            <label>Subject</label>
            <input type="text" id="ml-subject" value="${Utils.sanitizeHTML(log.subject)}">
          </div>
          <div class="form-group">
            <label>Topic</label>
            <input type="text" id="ml-topic" value="${Utils.sanitizeHTML(log.topic)}">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Duration (min)</label>
            <input type="number" id="ml-duration" value="${log.durationMinutes}" min="1">
          </div>
          <div class="form-group">
            <label>Date</label>
            <input type="date" id="ml-date" value="${log.date}">
          </div>
        </div>
        <div class="form-group">
          <label>Notes</label>
          <textarea id="ml-notes" rows="3">${Utils.sanitizeHTML(log.notes || '')}</textarea>
        </div>
        <div class="modal-actions">
          <button class="btn btn--ghost" onclick="UI.closeModal()">Cancel</button>
          <button class="btn btn--primary" onclick="UI._submitEditLog('${id}')">Save Changes</button>
        </div>
      </div>
    `;
    openModal(content, 'Edit Study Log');
  }

  async function _submitAddLog() {
    const subject = document.getElementById('ml-subject')?.value.trim();
    const topic = document.getElementById('ml-topic')?.value.trim();
    const durationMinutes = parseInt(document.getElementById('ml-duration')?.value, 10);
    const date = document.getElementById('ml-date')?.value || Utils.toDateString();
    const notes = document.getElementById('ml-notes')?.value.trim();
    const tagEls = document.querySelectorAll('#ml-tag-list .tag');
    const tags = Array.from(tagEls).map((el) => el.dataset.value || el.textContent);

    if (!subject || !topic || !durationMinutes) {
      showToast('Please fill in subject, topic, and duration', 'error');
      return;
    }

    await AppController.addStudyLog({ subject, topic, durationMinutes, notes, tags, date });
    closeModal();
    navigate('logs');
  }

  async function _submitEditLog(id) {
    const subject = document.getElementById('ml-subject')?.value.trim();
    const topic = document.getElementById('ml-topic')?.value.trim();
    const durationMinutes = parseInt(document.getElementById('ml-duration')?.value, 10);
    const date = document.getElementById('ml-date')?.value;
    const notes = document.getElementById('ml-notes')?.value.trim();
    await AppController.updateStudyLog(id, { subject, topic, durationMinutes, date, notes });
    closeModal();
    navigate('logs');
  }

  /* ---- MODAL: Add Note ---- */

  function openAddNoteModal() {
    const logs = Store.getState('studyLogs').slice(-20).reverse();

    const content = `
      <div class="modal-form">
        <div class="form-group">
          <label>Title</label>
          <input type="text" id="mn-title" placeholder="Note title">
        </div>
        <div class="form-group">
          <label>Content</label>
          <textarea id="mn-content" rows="4" placeholder="Write your notes here…"></textarea>
        </div>
        <div class="form-group">
          <label>Link to Study Session (optional)</label>
          <select id="mn-logid">
            <option value="">— None —</option>
            ${logs.map((l) => `<option value="${l.id}">${l.date}: ${Utils.sanitizeHTML(l.subject)} – ${Utils.sanitizeHTML(l.topic)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Attach Image (optional)</label>
          <div class="image-upload-area" id="image-upload-area">
            <input type="file" id="mn-image" accept="image/*" style="display:none"
              onchange="UI._previewNoteImage(this)">
            <div onclick="document.getElementById('mn-image').click()" class="image-upload-placeholder">
              📷 Click to select image or use camera
            </div>
            <img id="mn-image-preview" style="display:none;max-width:100%;border-radius:8px;margin-top:.5rem">
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn btn--ghost" onclick="UI.closeModal()">Cancel</button>
          <button class="btn btn--primary" onclick="UI._submitAddNote()">Save Note</button>
        </div>
      </div>
    `;
    openModal(content, 'Add Note');
  }

  function _previewNoteImage(input) {
    const file = input.files[0];
    if (!file) return;
    const preview = document.getElementById('mn-image-preview');
    const reader = new FileReader();
    reader.onload = (e) => {
      preview.src = e.target.result;
      preview.style.display = 'block';
    };
    reader.readAsDataURL(file);
  }

  async function _submitAddNote() {
    const title = document.getElementById('mn-title')?.value.trim();
    const content = document.getElementById('mn-content')?.value.trim();
    const studyLogId = document.getElementById('mn-logid')?.value || null;
    const imageFile = document.getElementById('mn-image')?.files[0] || null;

    await AppController.addNote({ title, content, studyLogId }, imageFile);
    closeModal();
    navigate('notes');
  }

  /* ---- MODAL: Image Preview ---- */

  function openImagePreview(noteId) {
    const note = Store.getState('notes').find((n) => n.id === noteId);
    if (!note?.imageBase64) return;

    const content = `
      <div class="image-preview-modal">
        <img src="${note.imageBase64}" alt="${Utils.sanitizeHTML(note.title)}" style="width:100%;border-radius:8px">
        ${note.ocrText ? `<div class="ocr-text"><strong>Extracted Text:</strong><p>${Utils.sanitizeHTML(note.ocrText)}</p></div>` : ''}
      </div>
    `;
    openModal(content, note.title || 'Image Preview');
  }

  /* ---- HELPER: Color picker ---- */

  function _selectColor(el, pickerId) {
    document.querySelectorAll(`#${pickerId} .color-swatch`).forEach((s) => {
      s.classList.remove('color-swatch--selected');
    });
    el.classList.add('color-swatch--selected');
    const hiddenInput = document.getElementById('m-color');
    if (hiddenInput) hiddenInput.value = el.dataset.color;
  }

  /* ---- HELPER: Tag input ---- */

  function _addTagToForm(inputId, listId) {
    const input = document.getElementById(inputId);
    const list = document.getElementById(listId);
    if (!input || !list) return;
    const val = input.value.trim();
    if (!val) return;
    _addTagValueToForm(val, listId);
    input.value = '';
  }

  function _addTagValueToForm(value, listId) {
    const list = document.getElementById(listId);
    if (!list) return;
    // Prevent duplicates
    if (Array.from(list.children).some((c) => c.dataset.value === value)) return;
    const span = document.createElement('span');
    span.className = 'tag tag--removable';
    span.dataset.value = value;
    span.innerHTML = `${Utils.sanitizeHTML(value)} <button onclick="this.parentElement.remove()" type="button">×</button>`;
    list.appendChild(span);
  }

  /* ---- HELPER: Clear data confirmation ---- */

  function _confirmClearData() {
    if (!confirm('⚠️ Are you sure you want to clear ALL data? This cannot be undone.')) return;
    Promise.all([
      Database.clearStore(APP_CONFIG.db.stores.studyLogs),
      Database.clearStore(APP_CONFIG.db.stores.routines),
      Database.clearStore(APP_CONFIG.db.stores.notes),
      Database.clearStore(APP_CONFIG.db.stores.tags),
      Database.clearStore(APP_CONFIG.db.stores.points),
      Database.clearStore(APP_CONFIG.db.stores.streaks),
    ]).then(() => {
      ['studyLogs', 'routines', 'notes', 'tags'].forEach((k) => Store.setState(k, []));
      Store.setState('points', null);
      Store.setState('streak', null);
      showToast('All data cleared', 'info');
      navigate('dashboard');
    });
  }

  /* ---- HELPER: Subject badge color ---- */

  function _subjectBadgeColor(subject) {
    if (!subject) return '#95A5A6';
    let hash = 0;
    for (const c of subject) hash = c.charCodeAt(0) + ((hash << 5) - hash);
    return APP_CONFIG.subjectColors[Math.abs(hash) % APP_CONFIG.subjectColors.length];
  }

  return {
    navigate, showToast, openModal, closeModal,
    renderDashboard, renderPlanner, renderLogs, renderNotes,
    renderProgress, renderSearch, renderSettings,
    openAddRoutineModal, openEditRoutineModal,
    openAddLogModal, openEditLogModal, openQuickLogModal,
    openAddNoteModal, openImagePreview,
    _submitAddRoutine, _submitEditRoutine,
    _submitAddLog, _submitEditLog,
    _submitAddNote, _previewNoteImage,
    _selectColor, _addTagToForm, _addTagValueToForm,
    _handleSearchInput, _confirmClearData,
  };
})();

/* ============================================================
   SECTION 17 — DOM BUILDER (injects HTML shell into page)
   ============================================================ */

const DOMBuilder = (() => {
  /**
   * Inject all required styles
   */
  function injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
      /* ====== RESET & BASE ====== */
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

      :root {
        --primary:       #3498DB;
        --primary-dark:  #2980B9;
        --accent:        #E67E22;
        --success:       #2ECC71;
        --danger:        #E74C3C;
        --warning:       #F39C12;
        --info:          #3498DB;
        --bg:            #F4F6FA;
        --surface:       #FFFFFF;
        --surface2:      #EDF2F7;
        --border:        #E2E8F0;
        --text:          #1A202C;
        --text-muted:    #718096;
        --radius:        12px;
        --radius-sm:     6px;
        --shadow:        0 2px 12px rgba(0,0,0,.08);
        --shadow-lg:     0 8px 32px rgba(0,0,0,.14);
        --nav-h:         64px;
        --header-h:      56px;
        --font:          -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        --transition:    .2s ease;
      }

      body {
        font-family: var(--font);
        background: var(--bg);
        color: var(--text);
        min-height: 100vh;
        overflow-x: hidden;
        -webkit-font-smoothing: antialiased;
      }

      /* ====== APP SHELL ====== */
      #app {
        max-width: 480px;
        margin: 0 auto;
        min-height: 100vh;
        background: var(--surface);
        position: relative;
        box-shadow: var(--shadow-lg);
      }

      #page-root {
        padding: 1rem;
        padding-bottom: calc(var(--nav-h) + 1rem);
        min-height: calc(100vh - var(--nav-h));
        overflow-y: auto;
      }

      /* ====== LOADING SCREEN ====== */
      #loading-screen {
        position: fixed; inset: 0;
        background: var(--primary);
        display: flex; flex-direction: column;
        align-items: center; justify-content: center;
        z-index: 9999; color: #fff;
        transition: opacity .4s ease;
      }
      #loading-screen.hidden { opacity: 0; pointer-events: none; }
      .loading-logo { font-size: 3rem; margin-bottom: 1rem; animation: pulse 1.5s infinite; }
      .loading-text { font-size: 1.2rem; font-weight: 600; }
      .loading-sub { font-size: .85rem; opacity: .8; margin-top: .3rem; }
      @keyframes pulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.1)} }

      /* ====== NAVIGATION ====== */
      #bottom-nav {
        position: fixed;
        bottom: 0; left: 50%;
        transform: translateX(-50%);
        width: 100%; max-width: 480px;
        height: var(--nav-h);
        background: var(--surface);
        border-top: 1px solid var(--border);
        display: flex;
        z-index: 100;
        box-shadow: 0 -2px 12px rgba(0,0,0,.06);
      }
      .nav-btn {
        flex: 1;
        display: flex; flex-direction: column;
        align-items: center; justify-content: center;
        gap: 3px;
        border: none; background: none;
        cursor: pointer; color: var(--text-muted);
        font-size: .65rem; font-weight: 500;
        transition: color var(--transition);
        padding: 0;
      }
      .nav-btn__icon { font-size: 1.35rem; transition: transform var(--transition); }
      .nav-btn--active { color: var(--primary); }
      .nav-btn--active .nav-btn__icon { transform: scale(1.15); }

      /* ====== TOAST ====== */
      .toast {
        position: fixed; bottom: calc(var(--nav-h) + 12px);
        left: 50%; transform: translateX(-50%) translateY(20px);
        background: var(--text); color: #fff;
        padding: .65rem 1.25rem; border-radius: 24px;
        font-size: .875rem; font-weight: 500;
        opacity: 0; transition: all .3s ease;
        z-index: 2000; white-space: nowrap;
        pointer-events: none; max-width: 90vw;
      }
      .toast--visible { opacity: 1; transform: translateX(-50%) translateY(0); }
      .toast--success { background: var(--success); }
      .toast--error   { background: var(--danger); }
      .toast--warning { background: var(--warning); }
      .toast--info    { background: var(--primary); }

      /* ====== MODAL ====== */
      .modal-overlay {
        position: fixed; inset: 0;
        background: rgba(0,0,0,.5);
        display: flex; align-items: flex-end;
        z-index: 1000;
        opacity: 0; pointer-events: none;
        transition: opacity .25s ease;
      }
      .modal-overlay--visible { opacity: 1; pointer-events: all; }
      .modal {
        background: var(--surface);
        border-radius: var(--radius) var(--radius) 0 0;
        width: 100%; max-height: 90vh;
        overflow-y: auto; padding: 1.5rem;
        transform: translateY(100%);
        transition: transform .3s cubic-bezier(.32,1,.24,1);
      }
      .modal-overlay--visible .modal { transform: translateY(0); }
      .modal__header {
        display: flex; justify-content: space-between;
        align-items: center; margin-bottom: 1.25rem;
      }
      .modal__title { font-size: 1.1rem; font-weight: 700; }
      .modal__close {
        border: none; background: var(--surface2);
        border-radius: 50%; width: 32px; height: 32px;
        cursor: pointer; font-size: 1rem;
        display: flex; align-items: center; justify-content: center;
      }
      .modal-actions {
        display: flex; gap: .75rem; justify-content: flex-end;
        margin-top: 1.25rem;
      }

      /* ====== BUTTONS ====== */
      .btn {
        display: inline-flex; align-items: center; justify-content: center;
        gap: .4rem; padding: .65rem 1.25rem;
        border-radius: var(--radius-sm); border: none;
        font-size: .875rem; font-weight: 600;
        cursor: pointer; transition: all var(--transition);
        text-decoration: none; white-space: nowrap;
      }
      .btn--primary { background: var(--primary); color: #fff; }
      .btn--primary:hover { background: var(--primary-dark); }
      .btn--ghost { background: var(--surface2); color: var(--text); border: 1px solid var(--border); }
      .btn--ghost:hover { background: var(--border); }
      .btn--danger { background: var(--danger); color: #fff; }
      .btn--link { background: none; color: var(--primary); padding: 0; text-decoration: underline; }
      .btn--sm { padding: .4rem .8rem; font-size: .8rem; }

      /* ====== FORM ELEMENTS ====== */
      .form-group { display: flex; flex-direction: column; gap: .4rem; }
      .form-group label { font-size: .8rem; font-weight: 600; color: var(--text-muted); }
      .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: .75rem; }
      input[type="text"], input[type="number"], input[type="date"],
      input[type="time"], input[type="email"], select, textarea {
        width: 100%; padding: .65rem .9rem;
        border: 1.5px solid var(--border);
        border-radius: var(--radius-sm);
        font-size: .9rem; font-family: var(--font);
        background: var(--surface); color: var(--text);
        transition: border-color var(--transition);
        outline: none;
      }
      input:focus, select:focus, textarea:focus { border-color: var(--primary); }
      textarea { resize: vertical; }
      .modal-form { display: flex; flex-direction: column; gap: 1rem; }

      /* ====== COLOR PICKER ====== */
      .color-picker { display: flex; flex-wrap: wrap; gap: .5rem; }
      .color-swatch {
        width: 28px; height: 28px; border-radius: 50%;
        cursor: pointer; border: 3px solid transparent;
        transition: border-color var(--transition), transform var(--transition);
      }
      .color-swatch--selected { border-color: var(--text); transform: scale(1.15); }

      /* ====== TAGS ====== */
      .tag-list { display: flex; flex-wrap: wrap; gap: .4rem; margin-top: .4rem; }
      .tag {
        display: inline-flex; align-items: center; gap: .3rem;
        padding: .2rem .65rem; border-radius: 24px;
        background: var(--surface2); border: 1px solid var(--border);
        font-size: .75rem; font-weight: 500; color: var(--text);
      }
      .tag--clickable { cursor: pointer; }
      .tag--clickable:hover { background: var(--border); }
      .tag--removable button {
        background: none; border: none; cursor: pointer;
        font-size: .85rem; color: var(--text-muted); padding: 0;
      }
      .tag-suggestions { margin-top: .5rem; }
      .tag-input-wrap { display: flex; flex-direction: column; gap: .4rem; }

      /* ====== CARDS ====== */
      .stat-grid {
        display: grid; grid-template-columns: 1fr 1fr;
        gap: .75rem; margin: 1rem 0;
      }
      .stat-card {
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        padding: 1rem; text-align: center;
        box-shadow: var(--shadow);
      }
      .stat-card__icon { font-size: 1.5rem; }
      .stat-card__value { font-size: 1.6rem; font-weight: 800; margin: .3rem 0; }
      .stat-card__label { font-size: .75rem; color: var(--text-muted); font-weight: 500; }

      .routine-card {
        background: var(--surface);
        border: 1px solid var(--border);
        border-left: 4px solid var(--primary);
        border-radius: var(--radius-sm);
        padding: .85rem 1rem;
        display: flex; align-items: center; gap: .75rem;
        margin-bottom: .6rem; box-shadow: var(--shadow);
      }
      .routine-card__time { font-size: .75rem; color: var(--text-muted); min-width: 80px; }
      .routine-card__info { flex: 1; }
      .routine-card__info strong { display: block; font-size: .9rem; }
      .routine-card__info span { font-size: .8rem; color: var(--text-muted); }
      .routine-card__actions { display: flex; gap: .4rem; }

      .log-card {
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
        padding: .85rem; margin-bottom: .6rem;
        display: flex; gap: .75rem; align-items: flex-start;
        box-shadow: var(--shadow);
      }
      .log-card--detailed { flex-wrap: wrap; }
      .log-card__left { flex: 1; display: flex; gap: .75rem; align-items: flex-start; }
      .log-card__right { display: flex; flex-direction: column; align-items: flex-end; gap: .4rem; }
      .log-card__subject {
        padding: .25rem .6rem; border-radius: var(--radius-sm);
        font-size: .7rem; font-weight: 700; color: #fff;
        white-space: nowrap;
      }
      .log-card__info strong { display: block; font-size: .9rem; }
      .log-card__info span { font-size: .78rem; color: var(--text-muted); }
      .log-card__notes { font-size: .8rem; color: var(--text-muted); margin-top: .3rem; }
      .log-card__points { font-size: .8rem; font-weight: 700; color: var(--success); }
      .log-card__actions { display: flex; gap: .4rem; }

      /* ====== DASHBOARD ====== */
      .dashboard__header {
        display: flex; justify-content: space-between;
        align-items: center; margin-bottom: 1rem;
        padding-top: .5rem;
      }
      .dashboard__greeting { font-size: 1.2rem; font-weight: 800; }
      .dashboard__date { font-size: .8rem; color: var(--text-muted); }
      .dashboard__avatar {
        width: 42px; height: 42px; border-radius: 50%;
        background: var(--primary); color: #fff;
        display: flex; align-items: center; justify-content: center;
        font-weight: 700; font-size: 1rem; cursor: pointer;
        flex-shrink: 0;
      }

      .motivational-banner {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: #fff; border-radius: var(--radius);
        padding: .85rem 1rem; margin-bottom: 1rem;
        display: flex; gap: .75rem; align-items: center;
      }
      .motivational-banner__icon { font-size: 1.4rem; flex-shrink: 0; }
      .motivational-banner p { font-size: .875rem; font-weight: 500; }

      .section-header {
        display: flex; justify-content: space-between;
        align-items: center; margin: 1.25rem 0 .6rem;
      }
      .section-header h2 { font-size: 1rem; font-weight: 700; }

      /* ====== PLANNER ====== */
      .week-grid {
        display: grid; grid-template-columns: repeat(7,1fr);
        gap: 4px; overflow-x: auto; margin-bottom: 1rem;
      }
      .week-col { min-width: 56px; }
      .week-col__header {
        text-align: center; font-size: .7rem; font-weight: 700;
        padding: .4rem .2rem; color: var(--text-muted);
        border-bottom: 2px solid var(--border);
        margin-bottom: .3rem;
      }
      .week-col__empty { text-align: center; color: var(--border); font-size: .75rem; padding: .5rem 0; }
      .routine-block {
        border-radius: 6px; padding: .4rem .5rem; margin-bottom: 4px;
        cursor: pointer; transition: opacity var(--transition);
      }
      .routine-block:hover { opacity: .8; }
      .routine-block__time { font-size: .6rem; color: var(--text-muted); }
      .routine-block__subject { font-size: .7rem; font-weight: 700; line-height: 1.2; }
      .routine-block__topic { font-size: .6rem; color: var(--text-muted); }

      /* ====== NOTES ====== */
      .notes-grid {
        display: grid; grid-template-columns: 1fr 1fr;
        gap: .75rem;
      }
      .note-card {
        background: var(--surface); border: 1px solid var(--border);
        border-radius: var(--radius); overflow: hidden;
        box-shadow: var(--shadow);
      }
      .note-card--compact { padding: .75rem; }
      .note-card__img-wrap img { width: 100%; height: 100px; object-fit: cover; cursor: pointer; }
      .note-card__body { padding: .75rem; }
      .note-card__body h3 { font-size: .875rem; font-weight: 700; margin-bottom: .3rem; }
      .note-card__body p { font-size: .775rem; color: var(--text-muted); }
      .note-card__ocr { font-size: .7rem; color: var(--primary); margin-top: .3rem; }
      .note-card__footer {
        display: flex; justify-content: space-between;
        align-items: center; margin-top: .6rem;
        padding-top: .6rem; border-top: 1px solid var(--border);
        font-size: .7rem; color: var(--text-muted);
      }

      /* ====== PROGRESS ====== */
      .level-card {
        background: linear-gradient(135deg,#f093fb 0%,#f5576c 100%);
        border-radius: var(--radius); padding: 1.25rem;
        display: flex; gap: 1rem; align-items: center;
        color: #fff; margin-bottom: 1rem;
      }
      .level-card__icon { font-size: 2.5rem; }
      .level-card__name { font-size: 1rem; font-weight: 800; }
      .level-card__points { font-size: .85rem; opacity: .9; }
      .level-card__next { font-size: .75rem; opacity: .8; margin-top: .25rem; }
      .progress-bar {
        background: rgba(255,255,255,.3); border-radius: 99px;
        height: 6px; margin-top: .5rem;
      }
      .progress-bar__fill {
        background: #fff; border-radius: 99px; height: 100%;
        transition: width .6s ease;
      }

      .chart-section { margin: 1.25rem 0; }
      .chart-section h2 { font-size: 1rem; font-weight: 700; margin-bottom: .75rem; }
      .chart-wrap { position: relative; height: 200px; }
      .chart-wrap canvas { max-height: 200px; }
      .heatmap-wrap { overflow-x: auto; padding-bottom: .5rem; }

      .export-section { margin-top: 1.5rem; }
      .export-section h2 { font-size: 1rem; font-weight: 700; margin-bottom: .75rem; }
      .export-btns { display: flex; flex-wrap: wrap; gap: .75rem; }

      /* ====== SEARCH ====== */
      .search-bar {
        display: flex; align-items: center; gap: .75rem;
        background: var(--surface2); border: 1.5px solid var(--border);
        border-radius: 999px; padding: .65rem 1rem;
        margin-bottom: 1rem;
      }
      .search-bar__icon { font-size: 1.1rem; }
      .search-bar input { flex: 1; border: none; background: none; font-size: .9rem; outline: none; }
      .search-count { font-size: .8rem; color: var(--text-muted); margin-bottom: .75rem; }
      .search-group { margin-bottom: 1.25rem; }
      .search-group h3 { font-size: .85rem; font-weight: 700; color: var(--text-muted); margin-bottom: .5rem; }
      mark { background: #FFF3CD; border-radius: 2px; padding: 0 2px; }

      /* ====== SETTINGS ====== */
      .settings-section {
        background: var(--surface); border: 1px solid var(--border);
        border-radius: var(--radius); padding: 1rem;
        margin-bottom: .75rem;
      }
      .settings-section h2 { font-size: .95rem; font-weight: 700; margin-bottom: .75rem; }
      .settings-section--danger h2 { color: var(--danger); }
      .settings-stat-list { display: flex; flex-direction: column; gap: .5rem; }
      .settings-stat {
        display: flex; justify-content: space-between;
        font-size: .875rem; padding: .4rem 0;
        border-bottom: 1px solid var(--border);
      }
      .settings-stat:last-child { border-bottom: none; }
      .settings-btn-group { display: flex; flex-wrap: wrap; gap: .75rem; }
      .settings-version { font-size: .75rem; color: var(--text-muted); text-align: center; }

      /* ====== MISC ====== */
      .page-header {
        display: flex; justify-content: space-between;
        align-items: center; margin-bottom: 1rem; padding-top: .5rem;
      }
      .page-header h1 { font-size: 1.2rem; font-weight: 800; }
      .empty-state { color: var(--text-muted); font-size: .875rem; text-align: center; padding: 2rem 0; }
      .date-filter {
        display: flex; align-items: center; gap: .5rem;
        margin-bottom: 1rem; font-size: .8rem;
      }
      .date-filter input { flex: 1; }
      .image-upload-area { cursor: pointer; }
      .image-upload-placeholder {
        border: 2px dashed var(--border); border-radius: var(--radius-sm);
        padding: 1.5rem; text-align: center; color: var(--text-muted);
        font-size: .875rem;
      }
      .image-preview-modal img { width: 100%; }
      .ocr-text { margin-top: 1rem; background: var(--surface2); border-radius: var(--radius-sm); padding: .75rem; }
      .ocr-text strong { display: block; margin-bottom: .4rem; font-size: .8rem; }

      /* ====== FAB ====== */
      .fab {
        position: fixed; bottom: calc(var(--nav-h) + 16px); right: 50%;
        transform: translateX(calc(240px - 32px));
        width: 52px; height: 52px; border-radius: 50%;
        background: var(--primary); color: #fff;
        border: none; cursor: pointer; font-size: 1.5rem;
        box-shadow: 0 4px 16px rgba(52,152,219,.4);
        display: flex; align-items: center; justify-content: center;
        transition: transform var(--transition), box-shadow var(--transition);
        z-index: 90;
      }
      .fab:hover { transform: translateX(calc(240px - 32px)) scale(1.08); box-shadow: 0 6px 20px rgba(52,152,219,.5); }

      @media (max-width:480px) {
        .fab { right: 1rem; transform: none; }
        .fab:hover { transform: scale(1.08); }
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Build the full HTML shell
   */
  function build() {
    // App root
    const app = document.createElement('div');
    app.id = 'app';

    // Loading screen
    app.innerHTML = `
      <div id="loading-screen">
        <div class="loading-logo">📚</div>
        <div class="loading-text">SmartStudy</div>
        <div class="loading-sub">Loading your learning tracker…</div>
      </div>

      <div id="page-root"></div>

      <nav id="bottom-nav">
        <button class="nav-btn nav-btn--active" data-nav="dashboard" onclick="UI.navigate('dashboard')">
          <span class="nav-btn__icon">🏠</span>
          <span>Home</span>
        </button>
        <button class="nav-btn" data-nav="planner" onclick="UI.navigate('planner')">
          <span class="nav-btn__icon">📅</span>
          <span>Planner</span>
        </button>
        <button class="nav-btn" data-nav="logs" onclick="UI.navigate('logs')">
          <span class="nav-btn__icon">📖</span>
          <span>Log</span>
        </button>
        <button class="nav-btn" data-nav="notes" onclick="UI.navigate('notes')">
          <span class="nav-btn__icon">📝</span>
          <span>Notes</span>
        </button>
        <button class="nav-btn" data-nav="progress" onclick="UI.navigate('progress')">
          <span class="nav-btn__icon">📊</span>
          <span>Progress</span>
        </button>
        <button class="nav-btn" data-nav="search" onclick="UI.navigate('search')">
          <span class="nav-btn__icon">🔍</span>
          <span>Search</span>
        </button>
        <button class="nav-btn" data-nav="settings" onclick="UI.navigate('settings')">
          <span class="nav-btn__icon">⚙️</span>
          <span>Settings</span>
        </button>
      </nav>

      <!-- Toast -->
      <div id="toast" class="toast"></div>

      <!-- Modal -->
      <div id="modal-overlay" class="modal-overlay" onclick="UI._handleOverlayClick(event)">
        <div class="modal" role="dialog">
          <div class="modal__header">
            <h2 class="modal__title" id="modal-title"></h2>
            <button class="modal__close" onclick="UI.closeModal()" aria-label="Close">✕</button>
          </div>
          <div id="modal-body"></div>
        </div>
      </div>
    `;

    document.body.appendChild(app);
  }

  return { build, injectStyles };
})();

/* ============================================================
   SECTION 18 — SERVICE WORKER REGISTRATION (PWA)
   ============================================================ */

const PWAService = (() => {
  function register() {
    if (!('serviceWorker' in navigator)) return;

    // Inline SW as a Blob (avoids needing a separate sw.js file)
    const swCode = `
      const CACHE_NAME = 'smartstudy-v1';
      const STATIC_ASSETS = ['/'];

      self.addEventListener('install', (e) => {
        e.waitUntil(
          caches.open(CACHE_NAME).then((c) => c.addAll(STATIC_ASSETS))
        );
        self.skipWaiting();
      });

      self.addEventListener('activate', (e) => {
        e.waitUntil(
          caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
          )
        );
        self.clients.claim();
      });

      self.addEventListener('fetch', (e) => {
        if (e.request.method !== 'GET') return;
        e.respondWith(
          fetch(e.request)
            .then((res) => {
              const clone = res.clone();
              caches.open(CACHE_NAME).then((c) => c.put(e.request, clone));
              return res;
            })
            .catch(() => caches.match(e.request))
        );
      });
    `;

    const blob = new Blob([swCode], { type: 'application/javascript' });
    const swUrl = URL.createObjectURL(blob);
    navigator.serviceWorker.register(swUrl).catch(() => {});
  }

  return { register };
})();

/* ============================================================
   SECTION 19 — EXPOSE GLOBALS (for inline HTML event handlers)
   ============================================================ */

window.UI = UI;
window.AppController = AppController;
window.Store = Store;
window.ExportService = ExportService;
window.NotificationService = NotificationService;

// Extend UI with overlay click handler
UI._handleOverlayClick = function (e) {
  if (e.target.id === 'modal-overlay') UI.closeModal();
};

/* ============================================================
   SECTION 20 — BOOT SEQUENCE
   ============================================================ */

(async function main() {
  // 1. Inject CSS
  DOMBuilder.injectStyles();

  // 2. Build HTML shell
  DOMBuilder.build();

  // 3. Register Service Worker
  PWAService.register();

  // 4. Boot application (DB + state + services)
  await AppController.boot();

  // 5. Render initial page
  UI.navigate('dashboard');

  // 6. Hide loading screen
  const loadingScreen = document.getElementById('loading-screen');
  if (loadingScreen) {
    loadingScreen.classList.add('hidden');
    setTimeout(() => loadingScreen.remove(), 500);
  }

  console.log(`[SmartStudy] v${APP_CONFIG.version} booted successfully ✅`);
})();
