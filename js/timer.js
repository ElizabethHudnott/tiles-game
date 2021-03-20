const timerElement = document.getElementById('timer');
let startTime, timer, accumulatedTime;
let paused = false, running = false;

function updateTime() {
	let total = Math.round((accumulatedTime + performance.now() - startTime) / 1000);
	const seconds = total % 60;
	const secsStr = seconds.toString().padStart(2, '0');
	total -= seconds;
	const minutes = (total / 60) % 60;
	total -= minutes * 60;
	const hours = total / 3600;
	if (hours > 0) {
		const minsStr = minutes.toString().padStart(2, '0');
		timerElement.innerHTML = `${hours}:${minsStr}:${secsStr}`;
	} else {
		timerElement.innerHTML = `${minutes}:${secsStr}`;
	}
}

function reset() {
	timerElement.innerHTML = '0:00'
	accumulatedTime = 0;
	clearInterval(timer);
	timer = undefined;
	running = false;
	paused = false;
}

function start() {
	if (timer === undefined) {
		startTime = performance.now();
		timer = setInterval(updateTime, 1000);
		running = true;
		paused = false;
	}
}

function stopCounting() {
	if (running) {
		updateTime();
		accumulatedTime += performance.now() - startTime;
		clearInterval(timer);
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
