import timer from './timer.js';
const modalBackdrop = document.createElement('DIV');
modalBackdrop.classList.add('modal-backdrop');
let modal;

function modalDisplayChange(event) {
	let modalEvent;
	if (this.classList.contains('show')) {
		modalEvent = new Event('shown.modal');
	} else {
		this.style.display = 'none';
		modalEvent = new Event('hidden.modal');
	}
	this.dispatchEvent(modalEvent);
}

function show(item) {
	item.classList.add('show');
}

function openModal(id) {
	closeModal(false);
	modal = document.getElementById(id);
	modal.dispatchEvent(new Event('show.modal'));
	modalBackdrop.style.display = 'block';
	document.body.appendChild(modalBackdrop);
	modal = document.getElementById(id);
	modal.addEventListener('transitionend', modalDisplayChange);
	modal.style.display = 'block';
	setTimeout(show, 0, modal);
}

function closeModal(hideBackdrop = true) {
	if (modal === undefined) {
		return;
	}
	modal.dispatchEvent(new Event('hide.modal'));
	modal.classList.remove('show');
	if (hideBackdrop) {
		modalBackdrop.style.display = 'none';
	}
	modal = undefined;
}

function toggleModal(event) {
	const id = this.dataset.target;
	if (modal !== undefined && modal.id === id) {
		closeModal();
	} else {
		openModal(id);
	}
}

modalBackdrop.addEventListener('click', function (event) {
	if (event.target === this) {
		closeModal();
	}
})

for (let element of document.querySelectorAll('button[data-toggle="modal"]')) {
	element.addEventListener('click', toggleModal);
}

for (let element of document.querySelectorAll('button[data-dismiss="modal"]')) {
	element.addEventListener('click', closeModal);
}

const Components = {
	closeModal: function () { closeModal(true); },
	openModal
};
export default Components;
