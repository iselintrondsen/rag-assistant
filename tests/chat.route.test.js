'use strict';

const express = require('express');
const request = require('supertest');

function loadChatRouterWithMocks(options = {}) {
  jest.resetModules();

  const retrievalMock = {
    retrieveWithMultipleQueries: jest.fn(async () => ([
      {
        id: 1,
        content: 'WCAG handler om tilgjengelighet og universell utforming.',
        chunk_index: 0,
        document_name: 'uu.pdf',
        document_id: 2,
        similarity: '0.82',
      },
    ])),
    retrieveRecentChunks: jest.fn(async () => []),
    findDocumentByName: jest.fn(async () => null),
    getLatestDocument: jest.fn(async () => null),
    retrieveChunksForDocument: jest.fn(async () => []),
    retrieveRelevantChunksInDocument: jest.fn(async () => []),
    hasStrongEnoughContext: jest.fn(() => true),
  };

  const createMock = jest.fn(async (args) => {
    if (args.stream) {
      if (options.forceStreamError) {
        throw new Error('Simulert stream-feil');
      }

      async function* stream() {
        yield { choices: [{ delta: { content: 'Hei' } }] };
        yield { choices: [{ delta: { content: ' verden' } }] };
      }
      return stream();
    }

    if (args.response_format && args.response_format.type === 'json_object') {
      const isSuggestions = args.messages?.[0]?.content?.includes('Generer 3 korte');
      if (isSuggestions) {
        return {
          choices: [{ message: { content: JSON.stringify({ questions: ['Q1?', 'Q2?', 'Q3?'] }) } }],
        };
      }

      return {
        choices: [{ message: { content: JSON.stringify({ hypothesis: 'Hypotese', variant: 'Variant' }) } }],
      };
    }

    return { choices: [{ message: { content: 'Kort oppsummering av historikk.' } }] };
  });

  class OpenAI {
    constructor() {
      this.chat = {
        completions: {
          create: createMock,
        },
      };
    }
  }

  jest.doMock('../src/services/retrieval', () => retrievalMock);
  jest.doMock('openai', () => OpenAI);

  const chatRouter = require('../src/routes/chat');
  return { chatRouter };
}

describe('chat route', () => {
  test('avviser tom melding', async () => {
    const { chatRouter } = loadChatRouterWithMocks();
    const app = express();
    app.use(express.json());
    app.use('/api/chat', chatRouter);

    const res = await request(app)
      .post('/api/chat')
      .send({ message: '   ' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/kan ikke v.re tom/i);
  });

  test('avviser for lang melding', async () => {
    const { chatRouter } = loadChatRouterWithMocks();
    const app = express();
    app.use(express.json());
    app.use('/api/chat', chatRouter);

    const res = await request(app)
      .post('/api/chat')
      .send({ message: 'a'.repeat(2001) });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/for lang/i);
  });

  test('returnerer SSE-respons med status, delta og done', async () => {
    const { chatRouter } = loadChatRouterWithMocks();
    const app = express();
    app.use(express.json());
    app.use('/api/chat', chatRouter);

    const res = await request(app)
      .post('/api/chat')
      .send({ message: 'Hva er WCAG?', history: [] });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.text).toContain('"status":"preparing"');
    expect(res.text).toContain('"delta":"Hei"');
    expect(res.text).toContain('"done":true');
  });

  test('sender error-event ved intern feil i stream', async () => {
    silenceConsoleError();

    const { chatRouter } = loadChatRouterWithMocks({ forceStreamError: true });
    const app = express();
    app.use(express.json());
    app.use('/api/chat', chatRouter);

    const res = await request(app)
      .post('/api/chat')
      .send({ message: 'Hva er WCAG?', history: [] });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.text).toContain('"error":"Noe gikk galt ved generering av svar. Prøv igjen."');
    expect(res.text).toContain('"done":true');
  });
});
