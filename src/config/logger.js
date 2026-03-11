// src/config/logger.js
//
// Winston-logger med daglig rotasjon i produksjon.
// I development vises fargerik output i terminalen.
// I produksjon skrives JSON-logger til logs/app-YYYY-MM-DD.log

'use strict';

const { createLogger, format, transports } = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');
const fs   = require('fs');

const isProd = process.env.NODE_ENV === 'production';
const LOG_DIR = path.join(__dirname, '../../logs');

if (isProd && !fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// ─── Format ───────────────────────────────────────────────────────────────────

const devFormat = format.combine(
  format.colorize(),
  format.timestamp({ format: 'HH:mm:ss' }),
  format.printf(({ timestamp, level, message, ...meta }) => {
    const extra = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
    return `${timestamp} ${level}: ${message}${extra}`;
  })
);

const prodFormat = format.combine(
  format.timestamp(),
  format.errors({ stack: true }),
  format.json()
);

// ─── Transporter ──────────────────────────────────────────────────────────────

const loggerTransports = isProd
  ? [
      new DailyRotateFile({
        dirname:        LOG_DIR,
        filename:       'app-%DATE%.log',
        datePattern:    'YYYY-MM-DD',
        maxFiles:       '14d',   // behold logger i 14 dager
        zippedArchive:  true,
        level:          'info',
      }),
      new DailyRotateFile({
        dirname:        LOG_DIR,
        filename:       'error-%DATE%.log',
        datePattern:    'YYYY-MM-DD',
        maxFiles:       '30d',
        zippedArchive:  true,
        level:          'error',
      }),
    ]
  : [
      new transports.Console({ format: devFormat }),
    ];

const logger = createLogger({
  level:      isProd ? 'info' : 'debug',
  format:     isProd ? prodFormat : devFormat,
  transports: loggerTransports,
  // Ikke krasj på uhåndterte exceptions
  exceptionHandlers: isProd
    ? [new DailyRotateFile({ dirname: LOG_DIR, filename: 'exceptions-%DATE%.log' })]
    : [new transports.Console()],
  rejectionHandlers: isProd
    ? [new DailyRotateFile({ dirname: LOG_DIR, filename: 'rejections-%DATE%.log' })]
    : [new transports.Console()],
});

module.exports = logger;
