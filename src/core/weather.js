'use strict';
// Meteo della tua città (Open-Meteo, gratuito e senza chiave): serve solo a vestire
// i personaggi (ombrelli, sciarpe, occhiali da sole) e a mostrare pioggia o neve dalle finestre.
// Nessun dato personale: si manda solo il nome della città scelto nelle opzioni.

const { tr } = require('../i18n');

const REFRESH_MS = 30 * 60 * 1000;

function kindOf(code) {
  if (code == null) return 'unknown';
  if (code === 0) return 'clear';
  if (code <= 2) return 'partly';
  if (code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'storm';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  return 'cloudy';
}

class Weather {
  constructor(state, opts = {}) {
    this.state = state;
    this.fetch = opts.fetch || (typeof fetch === 'function' ? fetch : null);
    this.geo = null; // {city, lat, lon, name}
    this.timer = null;
    this.busy = false;
    this.lastCity = null;
  }
  start() {
    this.refresh();
    this.timer = setInterval(() => this.refresh(), 60 * 1000); // controlla ogni minuto se serve aggiornare
    this.timer.unref && this.timer.unref();
  }
  stop() { clearInterval(this.timer); }

  async getJson(url) {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 8000);
    try {
      const r = await this.fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Platypus' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } finally { clearTimeout(to); }
  }

  async refresh(force) {
    if (!this.fetch || this.busy) return;
    const city = String((this.state.settings && this.state.settings.weatherCity) || '').trim();
    if (!city) { if (this.state.weather) { this.state.weather = null; this.state.touch(); } this.lastCity = ''; return; }
    const w = this.state.weather;
    const changed = city !== this.lastCity;
    if (!force && !changed && w && Date.now() - w.t < REFRESH_MS) return;
    if (!force && !changed && w && w.error && Date.now() - w.t < 10 * 60 * 1000) return;
    this.busy = true;
    try {
      if (changed || !this.geo) {
        const g = await this.getJson('https://geocoding-api.open-meteo.com/v1/search?count=1&language=it&format=json&name=' + encodeURIComponent(city));
        const r = g && g.results && g.results[0];
        if (!r) throw new Error(tr('Città non trovata'));
        this.geo = { city, lat: r.latitude, lon: r.longitude, name: r.name + (r.country_code ? ' (' + r.country_code + ')' : '') };
      }
      const f = await this.getJson(`https://api.open-meteo.com/v1/forecast?latitude=${this.geo.lat}&longitude=${this.geo.lon}&current=temperature_2m,weather_code,is_day,wind_speed_10m&timezone=auto`);
      const c = f && f.current;
      if (!c) throw new Error(tr('Risposta senza dati'));
      this.state.weather = { city: this.geo.name, temp: c.temperature_2m, code: c.weather_code, kind: kindOf(c.weather_code), wind: c.wind_speed_10m, isDay: !!c.is_day, t: Date.now() };
    } catch (e) {
      this.state.weather = { city, error: e.name === 'AbortError' || /fetch failed|ENOTFOUND|ECONN/i.test(e.message) ? tr('Meteo non raggiungibile') : e.message, kind: 'unknown', t: Date.now() };
    } finally {
      this.lastCity = city;
      this.busy = false;
      this.state.touch();
    }
  }
}

module.exports = { Weather, kindOf };
