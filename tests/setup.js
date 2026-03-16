'use strict';

const activeRestorers = [];

function registerConsoleSilencer(methodName) {
  const spy = jest.spyOn(console, methodName).mockImplementation(() => {});
  activeRestorers.push(() => spy.mockRestore());
  return spy;
}

global.silenceConsoleWarn = function silenceConsoleWarn() {
  return registerConsoleSilencer('warn');
};

global.silenceConsoleError = function silenceConsoleError() {
  return registerConsoleSilencer('error');
};

afterEach(() => {
  while (activeRestorers.length > 0) {
    const restore = activeRestorers.pop();
    restore();
  }
});
