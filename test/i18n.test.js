'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveLocale, translate, translateError, messages } = require('../src/i18n');

test('selects supported system languages and falls back to English', () => {
  for (const [locale, expected] of [['de-DE', 'de'], ['fr_CA', 'fr'], ['es-MX', 'es'], ['en-GB', 'en'], ['it-IT', 'en'], ['', 'en'], [null, 'en']]) assert.equal(resolveLocale(locale), expected);
  assert.equal(translate('de-DE', 'Scanner connected'), 'Scanner verbunden');
  assert.equal(translate('it-IT', 'Scanner connected'), 'Scanner connected');
  assert.equal(translate('fr', 'Unknown {detail}', { detail: 'test' }), 'Unknown test');
});

test('every translation preserves its interpolation fields', () => {
  for (const [key, translations] of Object.entries(messages)) {
    assert.equal(translations.length, 3, key);
    const fields = [...key.matchAll(/\{\w+\}/g)].map((match) => match[0]).sort();
    for (const translation of translations) {
      assert.ok(translation, key);
      assert.deepEqual([...translation.matchAll(/\{\w+\}/g)].map((match) => match[0]).sort(), fields, key);
    }
  }
});

test('translates validation errors and retains external diagnostic details', () => {
  assert.equal(translateError('de-DE', "Error invoking remote method 'hosts:set': Error: Invalid network host."), 'Ungültiger Netzwerkhost.');
  assert.equal(translateError('fr', 'Invalid scan area.'), 'Zone de numérisation non valide.');
  assert.equal(translateError('es', 'Invalid brightness: expected 3 numeric values.'), 'brightness no válido: se esperaban 3 valores numéricos.');
  assert.equal(translateError('de', 'scanner.local: Device busy'), 'scanner.local: Gerät beschäftigt');
  assert.equal(translateError('fr', 'ECONNREFUSED 127.0.0.1'), 'Erreur : ECONNREFUSED 127.0.0.1');
  assert.equal(translateError('it', 'Invalid scan area.'), 'Invalid scan area.');
});