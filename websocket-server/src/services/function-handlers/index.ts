import { FunctionHandler } from "../../interfaces";
import { getWeatherFromCoords } from "./weather";
import { scheduleCalendlyMeeting } from "./calendly";

const functionHandlers: FunctionHandler[] = [];

functionHandlers.push(getWeatherFromCoords);
functionHandlers.push(scheduleCalendlyMeeting);


export default functionHandlers;