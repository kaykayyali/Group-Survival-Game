$(document).ready(function() {

	set_name();


	$('#name_input').on('submit', handle_submit);
	$('#enter_button').on('click', function() {
		$('#name_input').trigger('submit');
	});
	$('#name_input').keypress(function(e) {
	    if(e.which == 13) {
	        $('#name_input').trigger('submit');
	    }
	});
});


function get_user_name() {
	var user_name = $('#name_input').val();
	if (user_name.length) {
		return user_name.trim();
	}
	else {
		return undefined
	}
};

function handle_name_error() {
	$('#name_input_form').addClass('has-error');
	$('#name_input').prop('placeholder', "Invalid User Name.");
};

function handle_name_success() {
	$('#name_input_form').removeClass('has-error');
	$('#name_input_form').addClass('has-success');
	$('#name_input').prop('placeholder', "");
};

function handle_submit(event) {
	var user_name = get_user_name();
	if (!user_name) {
		console.log("Invalid User name");
		handle_name_error();
		return;
	}
	handle_name_success();
	set_user_name(user_name);
	set_loading();
	setTimeout(function() {
		location.replace('/game');
	}, 1000);
};

function set_loading() {
	$('body').children().hide();
	$('body').addClass('loading');
};

function set_name() {
	var name = Cookies.get('user-name');
	if (name) {
		$('#name_input').val(name);
	}
	else {
		return false;
	}
};

function set_user_name(user_name) {
	console.log("Saving user name as ", user_name);
	Cookies.set('user-name', user_name);
};
