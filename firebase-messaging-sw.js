importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

firebase.initializeApp({
  projectId: "techxzone-e692e",
  messagingSenderId: "115715756703",
  appId: "1:115715756703:web:c97d8cca69cec84bfe7fbe"
});

const messaging = firebase.messaging();

// ব্যাকগ্রাউন্ড নোটিফিকেশন হ্যান্ডলার
messaging.onBackgroundMessage((payload) => {
  const notificationTitle = (payload.data && payload.data.title) || 'Notification';
  const notificationOptions = {
    body: (payload.data && payload.data.body) || '',
    icon: (payload.data && payload.data.imageUrl) || ''
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});