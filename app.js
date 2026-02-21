const { useEffect, useMemo, useState } = React;

const WEATHER_CODE_MAP = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Depositing rime fog",
  51: "Light drizzle",
  53: "Moderate drizzle",
  55: "Dense drizzle",
  56: "Light freezing drizzle",
  57: "Dense freezing drizzle",
  61: "Slight rain",
  63: "Moderate rain",
  65: "Heavy rain",
  66: "Light freezing rain",
  67: "Heavy freezing rain",
  71: "Slight snowfall",
  73: "Moderate snowfall",
  75: "Heavy snowfall",
  77: "Snow grains",
  80: "Slight rain showers",
  81: "Moderate rain showers",
  82: "Violent rain showers",
  85: "Slight snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm with light hail",
  99: "Thunderstorm with heavy hail",
};

const API_BASE = (() => {
  const DEV_BASE = "http://localhost:8989";
  const PROD_BASE = "https://weather-api-72g0.onrender.com";

  if (typeof window === "undefined") return DEV_BASE;

  const manualBase = window.__API_BASE__;
  if (typeof manualBase === "string" && manualBase.trim()) {
    return manualBase.trim().replace(/\/+$/, "");
  }

  const manualEnv = window.__APP_ENV__;
  if (manualEnv === "development") return DEV_BASE;
  if (manualEnv === "production") return PROD_BASE;

  const host = window.location.hostname;
  const isLocal = host === "localhost" || host === "127.0.0.1";
  return isLocal ? DEV_BASE : PROD_BASE;
})();

const toCardinal = (degree) => {
  if (typeof degree !== "number") return "--";
  const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const index = Math.round(degree / 45) % 8;
  return directions[index];
};

const formatNumber = (value, digits = 1) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "--";
  }
  return Number(value).toFixed(digits);
};

const parseCoord = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

function App() {
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [coords, setCoords] = useState(null);
  const [locationName, setLocationName] = useState("");
  const [weather, setWeather] = useState(null);
  const [advice, setAdvice] = useState("");
  const [adviceStatus, setAdviceStatus] = useState("idle");
  const [adviceError, setAdviceError] = useState("");
  const [unit, setUnit] = useState("fahrenheit");
  const [cityQuery, setCityQuery] = useState("");
  const [cityStatus, setCityStatus] = useState("idle");
  const [cityError, setCityError] = useState("");
  const [manualLat, setManualLat] = useState("");
  const [manualLon, setManualLon] = useState("");

  useEffect(() => {
    const ping = () => {
      fetch(new URL("/api/heartbeat", API_BASE).toString()).catch(() => {});
    };
    ping();
    const intervalId = setInterval(ping, 1000);
    return () => clearInterval(intervalId);
  }, []);

  const canGeolocate = typeof navigator !== "undefined" && "geolocation" in navigator;

  const fetchWeather = async (latitude, longitude, unitOverride = unit, locationLabel = "") => {
    setStatus("loading");
    setError("");
    setAdvice("");
    setAdviceError("");
    setAdviceStatus("idle");
    setCityError("");
    try {
      const url = new URL("https://api.open-meteo.com/v1/forecast");
      url.searchParams.set("latitude", latitude);
      url.searchParams.set("longitude", longitude);
      url.searchParams.set(
        "current",
        "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m"
      );
      url.searchParams.set("timezone", "auto");
      url.searchParams.set(
        "temperature_unit",
        unitOverride === "fahrenheit" ? "fahrenheit" : "celsius"
      );
      url.searchParams.set("wind_speed_unit", unitOverride === "fahrenheit" ? "mph" : "kmh");

      const response = await fetch(url.toString());
      if (!response.ok) {
        throw new Error(`Weather service error (${response.status})`);
      }
      const data = await response.json();
      if (!data.current) {
        throw new Error("Weather data unavailable.");
      }

      const summaryText = WEATHER_CODE_MAP[data.current.weather_code] || "Variable conditions";
      const resolvedLocation =
        locationLabel || `${formatNumber(latitude, 4)}, ${formatNumber(longitude, 4)}`;
      setCoords({ lat: latitude, lon: longitude });
      setLocationName(resolvedLocation);
      setWeather({
        ...data.current,
        units: data.current_units,
        timezone: data.timezone,
      });
      setStatus("ready");

      const weatherPayload = {
        summary: summaryText,
        temperature: formatNumber(data.current.temperature_2m, 1),
        feelsLike: formatNumber(data.current.apparent_temperature, 1),
        humidity: formatNumber(data.current.relative_humidity_2m, 0),
        windSpeed: formatNumber(data.current.wind_speed_10m, 1),
        windDirection: toCardinal(data.current.wind_direction_10m),
        temperatureUnit: data.current_units.temperature_2m,
        windUnit: data.current_units.wind_speed_10m,
        time: data.current.time,
        timezone: data.timezone,
        location: resolvedLocation,
      };
      fetchAdvice(weatherPayload);
    } catch (err) {
      setStatus("error");
      setError(err.message || "Unable to load weather.");
    }
  };

  const fetchAdvice = async (weatherPayload) => {
    setAdviceStatus("loading");
    setAdviceError("");
    try {
      const response = await fetch(new URL("/api/suggest", API_BASE).toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weather: weatherPayload }),
      });
      const contentType = response.headers.get("content-type") || "";
      const rawText = await response.text();
      let data = {};
      if (contentType.includes("application/json")) {
        try {
          data = rawText ? JSON.parse(rawText) : {};
        } catch (err) {
          data = {};
        }
      }
      if (!response.ok) {
        throw new Error(
          data.error ||
            rawText ||
            "Unable to generate suggestions. Make sure `node server.js` is running."
        );
      }
      setAdvice(data.suggestion || rawText || "");
      setAdviceStatus("ready");
    } catch (err) {
      setAdviceStatus("error");
      setAdviceError(err.message || "Unable to generate suggestions.");
    }
  };

  const handleLocate = () => {
    if (!canGeolocate) {
      setStatus("error");
      setError("Geolocation is not supported in this browser.");
      return;
    }
    setStatus("locating");
    setError("");

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        fetchWeather(latitude, longitude, unit, "Current location");
      },
      (geoError) => {
        setStatus("error");
        if (geoError.code === geoError.PERMISSION_DENIED) {
          setError("Location access was blocked. Try the manual coordinates below.");
          return;
        }
        setError("Unable to retrieve your location. Try again or enter coordinates.");
      },
      {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 60000,
      }
    );
  };

  const handleManualSubmit = (event) => {
    event.preventDefault();
    const latValue = parseCoord(manualLat);
    const lonValue = parseCoord(manualLon);

    if (latValue === null || lonValue === null) {
      setStatus("error");
      setError("Enter a valid latitude and longitude.");
      return;
    }
    fetchWeather(latValue, lonValue);
  };

  const handleCitySubmit = async (event) => {
    event.preventDefault();
    const query = cityQuery.trim();
    if (!query) {
      setCityStatus("error");
      setCityError("Enter a city name.");
      return;
    }
    setCityStatus("loading");
    setCityError("");
    try {
      const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
      url.searchParams.set("name", query);
      url.searchParams.set("count", "1");
      url.searchParams.set("language", "en");
      url.searchParams.set("format", "json");
      const response = await fetch(url.toString());
      if (!response.ok) {
        throw new Error(`City lookup error (${response.status})`);
      }
      const data = await response.json();
      if (!data.results || data.results.length === 0) {
        throw new Error("No matching city found.");
      }
      const result = data.results[0];
      const label = [result.name, result.admin1, result.country].filter(Boolean).join(", ");
      setCityQuery(label);
      setCityStatus("ready");
      fetchWeather(result.latitude, result.longitude, unit, label);
    } catch (err) {
      setCityStatus("error");
      setCityError(err.message || "Unable to find that city.");
    }
  };

  const handleUnitToggle = () => {
    const next = unit === "fahrenheit" ? "celsius" : "fahrenheit";
    setUnit(next);
    if (coords) {
      fetchWeather(coords.lat, coords.lon, next, locationName);
    }
  };

  const displayLocation = useMemo(() => {
    if (locationName) return locationName;
    if (coords) return `${formatNumber(coords.lat, 4)}, ${formatNumber(coords.lon, 4)}`;
    return "--";
  }, [locationName, coords]);

  const summary = useMemo(() => {
    if (!weather) return "--";
    return WEATHER_CODE_MAP[weather.weather_code] || "Variable conditions";
  }, [weather]);

  const adviceItems = useMemo(() => {
    if (!advice) return [];
    return advice
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.replace(/^[-*]\s*/, ""))
      .map((line) => {
        const boldMatch = line.match(/^\*\*(.+?)\*\*:\s*(.+)$/);
        if (boldMatch) {
          return { label: boldMatch[1], text: boldMatch[2] };
        }
        const colonMatch = line.match(/^([^:]+):\s*(.+)$/);
        if (colonMatch) {
          return { label: colonMatch[1], text: colonMatch[2] };
        }
        return { label: "", text: line };
      });
  }, [advice]);

  const statusLabel = useMemo(() => {
    switch (status) {
      case "locating":
        return "Locating your device";
      case "loading":
        return "Fetching weather";
      case "ready":
        return "Live conditions";
      case "error":
        return "Needs attention";
      default:
        return "Waiting for location";
    }
  }, [status]);

  const adviceLabel = useMemo(() => {
    switch (adviceStatus) {
      case "loading":
        return "Styling your outfit";
      case "ready":
        return "Outfit suggestions";
      case "error":
        return "Suggestions paused";
      default:
        return "Waiting for weather";
    }
  }, [adviceStatus]);

  return (
    <div className="page">
      <div className="layout">
        <div className="column-stack">
          <header className="hero fade-in">
            <span className="eyebrow">Local Weather</span>
            <h1 className="title">Local Weather Atlas</h1>
            <p className="subtitle">
              A React-powered view of the sky around you. Pull weather from your GPS location,
              or drop in coordinates for a quick check.
            </p>
          </header>

          <section className="card suggestion-card fade-in" aria-live="polite">
            <div className={`status ${adviceStatus === "loading" ? "loading" : ""}`}>
              <span className="status-dot" />
              {adviceLabel}
            </div>

            {adviceError ? <div className="error">{adviceError}</div> : null}

            {adviceItems.length > 0 ? (
              <ul className="suggestion-list">
                {adviceItems.map((item, index) => (
                  <li key={`${item.label}-${item.text}-${index}`}>
                    {item.label ? (
                      <div className="suggestion-row">
                        <span className="suggestion-title">{item.label}</span>
                        <span className="suggestion-text">{item.text}</span>
                      </div>
                    ) : (
                      item.text
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="helper">
                {adviceStatus === "loading"
                  ? "Looking at the forecast to build an outfit."
                  : "Run a weather check to get clothing suggestions."}
              </p>
            )}
          </section>
        </div>

        <section className="card fade-in" aria-live="polite">
          <div className={`status ${status === "loading" || status === "locating" ? "loading" : ""}`}>
            <span className="status-dot" />
            {statusLabel}
          </div>

          {error ? <div className="error">{error}</div> : null}

          <div className="actions weather-actions">
            <button type="button" onClick={handleLocate} disabled={status === "locating"}>
              Use my location
            </button>
            <button type="button" className="ghost-button" onClick={handleUnitToggle}>
              Toggle to {unit === "fahrenheit" ? "Celsius" : "Fahrenheit"}
            </button>
          </div>
          <p className="helper">
            Works best on HTTPS or `localhost` so the browser can access GPS.
          </p>

          <div className="weather-main">
            <div className="temp">
              {weather ? `${formatNumber(weather.temperature_2m, 1)} ${weather.units.temperature_2m}` : "--"}
            </div>
            <div className="summary">{summary}</div>
          </div>

          <div className="detail-grid">
            <div className="detail">
              <span className="detail-label">Feels like</span>
              <span className="detail-value">
                {weather
                  ? `${formatNumber(weather.apparent_temperature, 1)} ${weather.units.apparent_temperature}`
                  : "--"}
              </span>
            </div>
            <div className="detail">
              <span className="detail-label">Humidity</span>
              <span className="detail-value">
                {weather
                  ? `${formatNumber(weather.relative_humidity_2m, 0)} ${weather.units.relative_humidity_2m}`
                  : "--"}
              </span>
            </div>
            <div className="detail">
              <span className="detail-label">Wind</span>
              <span className="detail-value">
                {weather
                  ? `${formatNumber(weather.wind_speed_10m, 1)} ${weather.units.wind_speed_10m} ${toCardinal(
                      weather.wind_direction_10m
                    )}`
                  : "--"}
              </span>
            </div>
            <div className="detail">
              <span className="detail-label">Coordinates</span>
              <span className="detail-value">
                {coords ? `${formatNumber(coords.lat, 4)}, ${formatNumber(coords.lon, 4)}` : "--"}
              </span>
            </div>
          </div>

          <div className="meta">
            {weather
              ? `Updated: ${weather.time} (${weather.timezone}) · Location: ${displayLocation}`
              : "Awaiting location data."}
          </div>

          <div className="form-inline">
            <div className="form-block">
              <p className="helper">Search by city name.</p>
              <form onSubmit={handleCitySubmit}>
                <div className="field-row single">
                  <div>
                    <label htmlFor="city">City</label>
                    <input
                      id="city"
                      name="city"
                      placeholder="San Francisco"
                      value={cityQuery}
                      onChange={(event) => {
                        setCityQuery(event.target.value);
                        if (cityStatus !== "idle") setCityStatus("idle");
                        if (cityError) setCityError("");
                      }}
                    />
                  </div>
                </div>
                <div className="actions">
                  <button type="submit" disabled={cityStatus === "loading"}>
                    {cityStatus === "loading" ? "Searching..." : "Search city"}
                  </button>
                </div>
              </form>
              {cityError ? <div className="error compact">{cityError}</div> : null}
            </div>

            <div className="form-block">
              <p className="helper">
                Manual fallback if GPS is blocked. Try a latitude between -90 and 90, longitude between -180 and 180.
              </p>
              <form onSubmit={handleManualSubmit}>
                <div className="field-row">
                  <div>
                    <label htmlFor="latitude">Latitude</label>
                    <input
                      id="latitude"
                      name="latitude"
                      inputMode="decimal"
                      placeholder="37.7749"
                      value={manualLat}
                      onChange={(event) => setManualLat(event.target.value)}
                    />
                  </div>
                  <div>
                    <label htmlFor="longitude">Longitude</label>
                    <input
                      id="longitude"
                      name="longitude"
                      inputMode="decimal"
                      placeholder="-122.4194"
                      value={manualLon}
                      onChange={(event) => setManualLon(event.target.value)}
                    />
                  </div>
                </div>
                <div className="actions">
                  <button type="submit">Check coordinates</button>
                </div>
              </form>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
