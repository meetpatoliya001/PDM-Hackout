const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();
const db = admin.firestore();

exports.updateLeaderboardWeekly = functions.pubsub
  .schedule('every friday 12:00')
  .timeZone('Asia/Kolkata')
  .onRun(async (context) => {
    const snapshot = await db.collection('reports').where('status', '==', 'Verified').get();
    const pointsMap = {};

    snapshot.forEach(doc => {
      const data = doc.data();
      if (!pointsMap[data.userId]) pointsMap[data.userId] = 0;
      pointsMap[data.userId] += 10;
    });

    for (const userId in pointsMap) {
      await db.collection('leaderboards').doc(userId).set({
        points: pointsMap[userId],
        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    }

    console.log("Leaderboard updated successfully!");
    return null;
  });
