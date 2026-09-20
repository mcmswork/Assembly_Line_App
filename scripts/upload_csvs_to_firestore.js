#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const ROOT = path.resolve(__dirname, '..');
const DB = path.join(ROOT, 'db');
const projectId = process.env.FIREBASE_PROJECT_ID || 'assembly-line-app-8a20c';
const databaseId = process.env.FIRESTORE_DATABASE_ID || 'default';

const firebaseApp = initializeApp({
  credential: applicationDefault(),
  projectId,
});

const firestore = getFirestore(firebaseApp, databaseId);

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];
    if (character === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === ',' && !quoted) {
      row.push(cell.trim());
      cell = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && next === '\n') index += 1;
      row.push(cell.trim());
      cell = '';
      if (row.some(value => value !== '')) rows.push(row);
      row = [];
    } else {
      cell += character;
    }
  }

  if (cell !== '' || row.length) {
    row.push(cell.trim());
    if (row.some(value => value !== '')) rows.push(row);
  }
  return rows;
}

function readCsv(filename) {
  const rows = parseCsv(fs.readFileSync(path.join(DB, filename), 'utf8'));
  const headers = rows.shift() || [];
  return rows.map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] || ''])));
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function product(row) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    size: row.size,
    material: row.material,
    stock: number(row.stock),
    minStock: number(row.minStock),
    pmCode: row.pmCode || '',
  };
}

function kit(row) {
  return {
    name: row.name,
    short: row.short,
    colour: row.colour,
    orderQty: number(row.orderQty, 500),
  };
}

function packaging(row) {
  return {
    code: row.code,
    name: row.name,
    stock: number(row.stock),
    kits: row.kits,
    minQty: number(row.minQty),
  };
}

function rawMaterial(row) {
  return {
    code: row.code,
    name: row.name,
    qtyKg: number(row.qtyKg),
    minQty: number(row.minQty),
  };
}

function kitItem(row) {
  return {
    productCode: row.productCode,
    step: row.step,
    pcs: number(row.pcs, 1),
    section: row.section || 'Main Kit',
    comment: row.comment || '',
  };
}

async function uploadCollection(collectionName, rows, idField, mapRow) {
  const batch = firestore.batch();
  rows.forEach(row => {
    const id = String(row[idField] || '').trim();
    if (!id) throw new Error(`${collectionName}: missing ${idField}`);
    batch.set(firestore.collection(collectionName).doc(id), mapRow(row));
  });
  if (rows.length) await batch.commit();
  console.log(`${collectionName}: ${rows.length} documents`);
}

async function uploadKitItems(kitId) {
  const rows = readCsv(`${kitId}.csv`);
  const batch = firestore.batch();
  rows.forEach((row, index) => {
    const itemId = `item${String(index + 1).padStart(3, '0')}`;
    batch.set(firestore.collection('kits').doc(kitId).collection('items').doc(itemId), kitItem(row));
  });
  if (rows.length) await batch.commit();
  console.log(`kits/${kitId}/items: ${rows.length} documents`);
}

async function main() {
  await uploadCollection('products', readCsv('products.csv'), 'id', product);
  const kits = readCsv('kits.csv');
  await uploadCollection('kits', kits, 'id', kit);
  await uploadCollection('packaging', readCsv('packaging.csv'), 'code', packaging);
  await uploadCollection('rawMaterials', readCsv('raw_materials.csv'), 'code', rawMaterial);

  for (const row of kits) await uploadKitItems(row.id);

  const kitMaterials = readCsv('kit_materials.csv');
  if (kitMaterials.length) {
    await uploadCollection('kitMaterials', kitMaterials, 'code', row => ({
      kitId: row.kitId,
      kind: row.kind,
      code: row.code,
      name: row.name,
      qtyPer6: number(row.qtyPer6, 1),
      unit: row.unit,
      gmsEach: number(row.gmsEach),
    }));
  } else {
    console.log('kitMaterials: skipped because kit_materials.csv is empty');
  }

  console.log('Firestore upload complete');
}

main().catch(error => {
  console.error(`Firestore upload failed for project ${projectId}, database ${databaseId}`);
  console.error(`Code: ${error.code || 'unknown'}`);
  console.error(error.message || error);
  if (error.details) console.error(`Details: ${error.details}`);
  process.exitCode = 1;
});
