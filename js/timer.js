const timerElement = document.getElementById('timer');
let startTime, timer, accumulatedTime;
let paused = false, running = false;

function displayTime(elapsed) {
	const seconds = elapsed % 60;
	const secsStr = seconds.toString().padStart(2, '0');
	elapsed -= seconds;
	const minutes = (elapsed / 60) % 60;
	elapsed -= minutes * 60;
	const hours = elapsed / 3600;
	let width;
	if (hours > 0) {
		const minsStr = minutes.toString().padStart(2, '0');
		timerElement.innerHTML = `${hours}:${minsStr}:${secsStr}`;
		width = 5.6;
	} else {
		timerElement.innerHTML = `${minutes}:${secsStr}`;
		width = minutes > 9 ? 4.3 : 3.3;
	}
	timerElement.style.width = width + 'ch';
}

function secondsElapsed() {
	return Math.round((accumulatedTime + performance.now() - startTime) / 1000);
}

function tick() {
	const seconds = secondsElapsed();
	displayTime(seconds);
	const targetNext = startTime + (seconds + 1) * 1000 - accumulatedTime;
	timer = setTimeout(tick, targetNext - performance.now());
}

function reset() {
	timerElement.innerHTML = '0:00'
	accumulatedTime = 0;
	clearTimeout(timer);
	timer = undefined;
	running = false;
	paused = false;
}

function start() {
	if (timer === undefined) {
		const millis = accumulatedTime % 1000;
		accumulatedTime -= millis;
		startTime = performance.now() - millis;
		timer = setTimeout(tick, 1000 - millis);
		running = true;
		paused = false;
	}
}

function stopCounting() {
	if (running) {
		// displayTime(secondsElapsed());
		accumulatedTime += performance.now() - startTime;
		clearTimeout(timer);
		timer = undefined;
	}
}

function pause() {
	if (running) {
		stopCounting();
		running = false;
		paused = true;
	}
}

function resume() {
	if (paused) {
		start();
	}
}

function stop() {
	stopCounting();
	running = false;
	paused = false;
}

document.addEventListener('visibilitychange', function (event) {
	if (document.visibilityState !== 'visible') {
		stopCounting();
	} else if (running) {
		start();
	}
});

const Timer = {start, pause, resume, stop, reset};
Object.defineProperty(Timer, 'time', {
	get: function () {
		return accumulatedTime;
	}
});
Object.defineProperty(Timer, 'paused', {
	get: function () {
		return paused;
	}
});
export default Timer;
