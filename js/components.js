import timer from './timer.js';
const modalBackdrop = document.createElement('DIV');
modalBackdrop.classList.add('modal-backdrop');
let modal;

function openModal(id) {
	closeModal(false);
	modalBackdrop.style.display = 'block';
	document.body.appendChild(modalBackdrop);
	modal = document.getElementById(id);
	modal.classList.add('show');
	modal.dispatchEvent(new Event('shown.modal'));
}

function closeModal(hideBackdrop = true) {
	if (modal === undefined) {
		return;
	}
	modal.classList.remove('show');
	if (hideBackdrop) {
		modalBackdrop.style.display = 'none';
	}
	modal.dispatchEvent(new Event('hidden.modal'));
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
