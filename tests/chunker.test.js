// tests/chunker.test.js
//
// Unit-tester for tekst-chunking

'use strict';

const { chunkText } = require('../src/services/chunker');

describe('chunkText', () => {
  test('returnerer tom array for tom tekst', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('   ')).toEqual([]);
  });

  test('returnerer én chunk for kort tekst', () => {
    const result = chunkText('Dette er en kort tekst.');
    expect(result).toHaveLength(1);
    expect(result[0]).toBe('Dette er en kort tekst.');
  });

  test('deler lang tekst i flere chunks', () => {
    // Lag en tekst som er større enn CHUNK_SIZE (1200 tegn)
    const longText = 'Universell utforming handler om at produkter og tjenester skal kunne brukes av alle. '
      .repeat(20);
    const chunks = chunkText(longText);
    expect(chunks.length).toBeGreaterThan(1);
  });

  test('alle chunks er strenger', () => {
    const text = 'Ord '.repeat(500);
    const chunks = chunkText(text);
    chunks.forEach(c => expect(typeof c).toBe('string'));
  });

  test('chunks har ikke ledende/etterfølgende whitespace', () => {
    const text = 'Test '.repeat(400);
    const chunks = chunkText(text);
    chunks.forEach(c => {
      expect(c).toBe(c.trim());
    });
  });

  test('ingen chunk overskrider maks tegn vesentlig (setningsbasert tekst)', () => {
    const MAX_SIZE = 1200 * 1.2; // 20% toleranse for overlapp-logikk
    // Bruk setninger med punktum slik at chunker har naturlige delesteder
    const text = 'Dette er en testsetning om universell utforming. '.repeat(120);
    const chunks = chunkText(text);
    chunks.forEach(c => {
      expect(c.length).toBeLessThanOrEqual(MAX_SIZE);
    });
  });
});
