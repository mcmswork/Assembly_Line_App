#!/usr/bin/env node

const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

const action = process.argv[2];
const email = process.argv[3];
const projectId = process.env.FIREBASE_PROJECT_ID || 'assembly-line-app-8a20c';

if (!['allow', 'deny'].includes(action) || !email) {
  console.error('Usage: node scripts/set_user_access.js <allow|deny> <email>');
  process.exit(1);
}

initializeApp({ credential: applicationDefault(), projectId });

async function main() {
  const user = await getAuth().getUserByEmail(email);
  const claims = { ...(user.customClaims || {}), allowed: action === 'allow' };
  await getAuth().setCustomUserClaims(user.uid, claims);
  console.log(`${email}: ${action === 'allow' ? 'allowed' : 'denied'}`);
  console.log('The user must sign out and sign in again before the new access claim is available.');
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
