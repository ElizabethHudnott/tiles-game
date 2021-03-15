const timerElement = document.getElementById('timer');
let startTime, timer, accumulatedTime;

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
	startTime = undefined;
	clearInterval(timer);
	timer = undefined;
}

function start() {
	if (timer === undefined) {
		startTime = performance.now();
		timer = setInterval(updateTime, 1000);
	}
}

function pause() {
	accumulatedTime += performance.now() - startTime;
	clearInterval(timer);
	timer = undefined;
}

function stop() {
	updateTime();
	pause();
	startTime = undefined;
}

function getTime() {
	return accumulatedTime;
}

document.addEventListener('visibilitychange', function (event) {
	if (document.hidden) {
		pause();
	} else if (startTime !== undefined) {
		start();
	}
});

const Timer = {start, pause, stop, reset, getTime};
export default Timer;
