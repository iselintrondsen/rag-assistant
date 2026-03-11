
require('dotenv').config();
const express = require('express');
const router  = express.Router();
const OpenAI  = require('openai');

const {
  retrieveWithMultipleQueries,
  hasStrongEnoughContext,
} = require('../services/retrieval');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const CHAT_MODEL = process.env.CHAT_MODEL || 'gpt-4o-mini';

const FALLBACK_MESSAGE =
  'Jeg finner dessverre ikke et godt nok svar på dette i dokumentene dine. ' +
  'Prøv gjerne å omformulere spørsmålet, eller last opp et dokument som dekker temaet.';

const MAX_HISTORY          = 10;
const SUMMARIZE_THRESHOLD  = 8;   // Antall meldinger før vi begynner å oppsummere
const KEEP_VERBATIM        = 4;   // Antall nyeste meldinger vi alltid beholder urørt


async function prepareRetrieval(question, history) {
  const recentContext = history
    .slice(-4)
    .map(m => `${m.role === 'user' ? 'Bruker' : 'Assistent'}: ${m.content.slice(0, 150)}`)
    .join('\n');

  try {
    const completion = await openai.chat.completions.create({
      model:           'gpt-4o-mini',
      temperature:     0,
      max_tokens:      220,
      response_format: { type: 'json_object' },
      messages: [
        {
          role:    'system',
          content: 'Du hjelper med å forbedre dokumentsøk. Svar alltid med gyldig JSON i nøyaktig dette formatet:\n' +
                   '{ "hypothesis": "2-3 setninger faglig tekst som ville svart på spørsmålet", ' +
                   '"variant": "ett alternativt søkeuttrykk for det samme spørsmålet" }',
        },
        {
          role:    'user',
          content: recentContext
            ? `Samtalehistorikk:\n${recentContext}\n\nSpørsmål: ${question}`
            : question,
        },
      ],
    });

    const parsed = JSON.parse(completion.choices[0].message.content);
    const queries = [question];
    if (parsed.hypothesis) queries.push(parsed.hypothesis);
    if (parsed.variant)    queries.push(parsed.variant);
    return queries;

  } catch (err) {
    console.warn('[chat] prepareRetrieval feilet, bruker originalt spørsmål:', err.message);
    return [question];
  }
}


async function getHistorySummary(safeHistory) {
  if (safeHistory.length <= SUMMARIZE_THRESHOLD) return null;

  const toSummarize = safeHistory.slice(0, -KEEP_VERBATIM);

  try {
    const res = await openai.chat.completions.create({
      model:       'gpt-4o-mini',
      temperature: 0,
      max_tokens:  200,
      messages: [
        {
          role:    'system',
          content: 'Lag et kompakt sammendrag av denne samtalen på norsk (2-4 setninger). ' +
                   'Fokuser på hva som ble diskutert og eventuelle konklusjoner.',
        },
        {
          role:    'user',
          content: toSummarize
            .map(m => `${m.role === 'user' ? 'Bruker' : 'Assistent'}: ${m.content}`)
            .join('\n\n'),
        },
      ],
    });
    return res.choices[0].message.content.trim();
  } catch (err) {
    console.warn('[chat] getHistorySummary feilet:', err.message);
    return null;
  }
}


async function generateSuggestions(question, partialAnswer) {
  try {
    const completion = await openai.chat.completions.create({
      model:           'gpt-4o-mini',
      temperature:     0.7,
      max_tokens:      150,
      response_format: { type: 'json_object' },
      messages: [
        {
          role:    'system',
          content: 'Generer 3 korte, naturlige oppfølgingsspørsmål på norsk basert på spørsmålet og svaret. ' +
                   'Svar kun med JSON i dette formatet: { "questions": ["...", "...", "..."] }',
        },
        {
          role:    'user',
          content: `Spørsmål: ${question}\n\nSvar (utdrag): ${partialAnswer.slice(0, 400)}`,
        },
      ],
    });
    const parsed = JSON.parse(completion.choices[0].message.content);
    return Array.isArray(parsed.questions) ? parsed.questions.slice(0, 3) : [];
  } catch {
    return [];
  }
}


function buildMessageArray(systemPrompt, historySummary, safeHistory, userMessage) {
  const messages = [{ role: 'system', content: systemPrompt }];

  if (historySummary) {
    messages.push({
      role:    'system',
      content: `Oppsummering av tidligere i samtalen: ${historySummary}`,
    });
  }

  const recentHistory = historySummary
    ? safeHistory.slice(-KEEP_VERBATIM)
    : safeHistory;

  messages.push(...recentHistory);
  messages.push({ role: 'user', content: userMessage });

  return messages;
}


router.post('/', async (req, res) => {
  const { message, history, group } = req.body;
  const groupId = (typeof group === 'string' && group.trim()) ? group.trim().slice(0, 50) : null;

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({ error: 'Meldingen kan ikke være tom.' });
  }
  if (message.trim().length > 2000) {
    return res.status(400).json({ error: 'Meldingen er for lang (maks 2000 tegn).' });
  }

  const safeHistory = Array.isArray(history)
    ? history
        .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
        .slice(-MAX_HISTORY)
    : [];

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sendEvent = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    sendEvent({ status: 'preparing', text: 'Forbereder søk…' });

    const [queries, historySummary] = await Promise.all([
      prepareRetrieval(message.trim(), safeHistory),
      getHistorySummary(safeHistory),
    ]);

    sendEvent({ status: 'searching', text: `Søker med ${queries.length} søkeuttrykk…` });

    const chunks = await retrieveWithMultipleQueries(queries, undefined, groupId);


    const hasAnyChunks = chunks && chunks.length > 0;
    const hasContext = hasStrongEnoughContext(chunks);

    const shouldUseRAG = hasAnyChunks;

    const contextText = shouldUseRAG
      ? chunks
          .map((c, i) =>
            `[Kilde ${i + 1}: "${c.document_name}" – del ${c.chunk_index + 1}]\n${c.content}`
          )
          .join('\n\n---\n\n')
      : null;

    const fallbackNotice = !hasContext && hasAnyChunks
      ? '⚠️ Merk: Treffene er funnet med lav score, så svar med ekstra forsiktighet og angi hvis du må anta.'
      : '';

    const systemPrompt = shouldUseRAG
      ? `Du er en hjelpsom og vennlig fagassistent for kurset IS-217 Universellutforming.

Du svarer alltid på norsk – selv om spørsmålet er på et annet språk.

Slik jobber du:
- Du baserer deg utelukkende på kildene som er gitt nedenfor
- Du sier gjerne "Ifølge [dokumentnavn]..." eller "I [dokumentnavn] står det..." for å vise kildene
- Du tilpasser svarets lengde til spørsmålet – korte oppfølgingsspørsmål får kortere svar
- Start med den viktigste konklusjonen først
- Skriv lettskummede svar:
  - Korte avsnitt (maks 2-3 setninger per avsnitt)
  - Punktlister ved oppramsing eller flere momenter
  - Ved lengre svar (mer enn ca. 6 linjer), bruk korte Markdown-overskrifter
- Du husker samtalehistorikken og svarer naturlig på oppfølgingsspørsmål
- Hvis kildene ikke gir et godt nok svar, sier du ærlig fra uten å dikte opp noe
${fallbackNotice}

Tilgjengelige kilder:
────────────────────
${contextText}
────────────────────`
      : `Du er en hjelpsom og vennlig fagassistent for kurset IS-217 Universellutforming.

Du svarer alltid på norsk – selv om spørsmålet er på et annet språk.

Det er ikke lastet opp dokumenter som er relevante for dette spørsmålet.
- Er meldingen en hilsen eller småprat: svar vennlig og naturlig
- Er meldingen et fagspørsmål: si at du ikke finner svaret i dokumentene, og oppfordre brukeren til å laste opp relevante dokumenter
- Hold svaret kort, tydelig og lettskummet med korte avsnitt eller punktliste`;

    const messages = buildMessageArray(systemPrompt, historySummary, safeHistory, message.trim());

    sendEvent({ status: 'generating', text: 'Genererer svar…' });

    const stream = await openai.chat.completions.create({
      model:       CHAT_MODEL,
      messages,
      temperature: 0.4,
      max_tokens:  1500,
      stream:      true,
    });

    let fullAnswer        = '';
    let suggestionsPromise = null;

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        fullAnswer += delta;
        sendEvent({ delta });

        if (!suggestionsPromise && fullAnswer.length > 200) {
          suggestionsPromise = generateSuggestions(message.trim(), fullAnswer);
        }
      }
    }

    if (!suggestionsPromise) {
      suggestionsPromise = generateSuggestions(message.trim(), fullAnswer);
    }

    const sources = chunks.map(c => ({
      document:   c.document_name,
      snippet:    c.content.length > 220
        ? c.content.slice(0, 220).trimEnd() + '…'
        : c.content,
      similarity: Math.round(parseFloat(c.similarity) * 100),
    }));

    const suggestions = await suggestionsPromise;

    sendEvent({ done: true, sources });
    if (suggestions.length > 0) {
      sendEvent({ suggestions });
    }
    return res.end();

  } catch (err) {
    console.error('[chat] Feil:', err.message);
    try {
      sendEvent({ error: 'Noe gikk galt ved generering av svar. Prøv igjen.' });
      sendEvent({ done: true, sources: [] });
      res.end();
    } catch { /* tilkobling allerede lukket */ }
  }
});

module.exports = router;
