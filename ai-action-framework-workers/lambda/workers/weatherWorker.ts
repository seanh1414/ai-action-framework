import axios from 'axios';
import Worker from '../worker';

const WEATHER_API_KEY = process.env.WEATHER_API_KEY!;
const CURRENT_WEATHER_API_URL = 'https://api.weatherapi.com/v1/current.json?q=';
const FORECAST_WEATHER_API_URL = 'https://api.weatherapi.com/v1/forecast.json?q=';

class WeatherWorker extends Worker {
  constructor() {
    super(
      "Fetches real-time weather data including temperature and weather conditions for a specified location.",
      "WEATHER",
      {
        CURRENT: {
          description: "Get current weather for a location",
          input: { location: "text" },
          output: { temperature: "text", condition: "text" },
          path: "/weather/current"
        },
        FORECAST: {
          description: "Get weather forecast for a location",
          input: { location: "text", days: "number" },
          output: { forecast: "array of text" },
          path: "/weather/forecast"
        }
      }
    );
  }

  async execute(endpointKey: string, inputs: any) {
    if (!inputs || !inputs.location) {
      throw new Error("Invalid inputs: location is required");
    }

    const location = inputs.location;
    if (!WEATHER_API_KEY) {
      throw new Error("Weather API key is not set");
    }

    if (endpointKey === "CURRENT") {
      return await this.getCurrentWeather(location);
    }

    if (endpointKey === "FORECAST") {
      if (!inputs.days) {
        throw new Error("Invalid inputs: days are required for forecast");
      }
      return await this.getWeatherForecast(location, inputs.days);
    }

    // Ensure a value is always returned
    return {};
  }

  private async getCurrentWeather(location: string) {
    console.log(`Executing weather worker for current weather at location: ${location}`);

    try {
      const response = await axios.get(`${CURRENT_WEATHER_API_URL}${location}&key=${WEATHER_API_KEY}`);
      const data = response.data;

      console.log(`Weather API response: ${JSON.stringify(data)}`);

      // Return a string representation of the response
      return `Temperature: ${data.current.temp_c}°C, Condition: ${data.current.condition.text}`;
    } catch (error: any) {
      console.error(`Error executing weather worker: ${error.message}`);
      throw error;
    }
  }

  private async getWeatherForecast(location: string, days: number) {
    console.log(`Executing weather worker for weather forecast at location: ${location} for ${days} days`);

    try {
      const response = await axios.get(`${FORECAST_WEATHER_API_URL}${location}&days=${days}&key=${WEATHER_API_KEY}`);
      const data = response.data;

      console.log(`Weather API response: ${JSON.stringify(data)}`);

      // Extract and format the forecast data
      const forecast = data.forecast.forecastday.map((day: any) => {
        return `Date: ${day.date}, Condition: ${day.day.condition.text}, Max Temp: ${day.day.maxtemp_c}°C, Min Temp: ${day.day.mintemp_c}°C`;
      });

      // Return a string representation of the forecast
      return `Forecast for ${location}:\n${forecast.join('\n')}`;
    } catch (error: any) {
      console.error(`Error executing weather worker: ${error.message}`);
      throw error;
    }
  }
}

// Export the execute function
export const execute = async (event: any) => {
  const body = JSON.parse(event.body);
  const { endpointKey, inputs } = body;
  const weatherWorker = new WeatherWorker();

  console.log(`Received event: ${JSON.stringify(event)}`);

  try {
    const result = await weatherWorker.execute(endpointKey, inputs);
    console.log(`Weather worker result: ${result}`);
    return {
      statusCode: 200,
      body: JSON.stringify({ message: result }),
    };
  } catch (error: any) {
    console.error(`Error while executing weather worker: ${error.message}`);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: "Internal server error" }),
    };
  }
};

export default WeatherWorker;
