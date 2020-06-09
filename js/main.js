$(function () {

    // burger

    $('.burger').click(function () {
        $('.menu-collapse').toggleClass('d-none').css('order', '1');
        $('.menu').toggleClass('menu-active');
        $('.burger').toggleClass('burger-active');
    });

    // smoothscroll

    $("a.go").click(function (e) {
        e.preventDefault();
        elementClick = $(this).attr("href");
        destination = $(elementClick).offset().top - 70;
        $("body,html").animate({
            scrollTop: destination
        }, 800);
    });

    // modal

    $('.header .button, .footer .button').click(function (e) {
        e.preventDefault();
        $('#exampleModal').arcticmodal();
    });

    // slider 

    $('.slider').slick({
        dots: true
    });

});

// sticky header

$(window).scroll(function () {
    if ($(this).scrollTop() > 600) {
        $('header').addClass("sticky");
    } else {
        $('header').removeClass("sticky");
    }
});

$(window).on('load', function () {
    var $preloader = $('#page-preloader'),
        $spinner = $preloader.find('.spinner');
    $spinner.fadeOut();
    $preloader.delay(350).fadeOut('slow');
});