'use strict';

function loadRetrievalWithDbMock(dbQueryImpl) {
  jest.resetModules();

  const query = jest.fn(dbQueryImpl);

  jest.doMock('../src/config/database', () => ({ query }));
  jest.doMock('../src/services/embeddings', () => ({
    createQueryEmbedding: jest.fn(async () => [0.1, 0.2, 0.3]),
  }));

  const retrieval = require('../src/services/retrieval');
  return { retrieval, query };
}

describe('retrieval service', () => {
  test('bruker ikke group-filter når group_id-kolonne mangler', async () => {
    const { retrieval, query } = loadRetrievalWithDbMock(async (sql) => {
      if (sql.includes('information_schema.columns')) return { rowCount: 0, rows: [] };
      return { rows: [] };
    });

    await retrieval.retrieveRecentChunks(5, 'gruppe-a');

    const mainCall = query.mock.calls[1][0];
    expect(mainCall).not.toContain('d.group_id');
  });

  test('bruker group-filter når group_id-kolonne finnes', async () => {
    const { retrieval, query } = loadRetrievalWithDbMock(async (sql) => {
      if (sql.includes('information_schema.columns')) return { rowCount: 1, rows: [{ ok: 1 }] };
      if (sql.includes('FROM chunks c')) return { rows: [{ id: 1, similarity: '0.9' }] };
      return { rows: [] };
    });

    await retrieval.retrieveRelevantChunks('Hva er WCAG?', 3, 'gruppe-a');

    const mainCall = query.mock.calls[1][0];
    expect(mainCall).toContain('d.group_id = $3');
  });

  test('findDocumentByName faller tilbake til LIKE-sok nar exact ikke treffer', async () => {
    const { retrieval } = loadRetrievalWithDbMock(async (sql) => {
      if (sql.includes('information_schema.columns')) return { rowCount: 0, rows: [] };
      if (sql.includes('WHERE lower(original_name) = lower($1)')) return { rows: [] };
      if (sql.includes('WHERE lower(original_name) LIKE lower($1)')) {
        return { rows: [{ id: 9, original_name: 'notater-uu.pdf' }] };
      }
      return { rows: [] };
    });

    const result = await retrieval.findDocumentByName('uu.pdf');
    expect(result).toEqual({ id: 9, original_name: 'notater-uu.pdf' });
  });

  test('getLatestDocument returnerer null nar ingen dokumenter finnes', async () => {
    const { retrieval } = loadRetrievalWithDbMock(async (sql) => {
      if (sql.includes('information_schema.columns')) return { rowCount: 0, rows: [] };
      return { rows: [] };
    });

    const result = await retrieval.getLatestDocument();
    expect(result).toBeNull();
  });
});
